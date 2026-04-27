const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramData } = require('../middleware/auth');
const cryptobot = require('../cryptobot');

const COMMISSION = 0.05;

async function notifyViaBot(fn) {
  try {
    const botInstance = require('../botInstance');
    const bot = botInstance.get();
    if (bot) await fn(bot);
  } catch (err) {
    console.error('Bot notify error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// CryptoBot webhook — no auth, raw body for signature check
// ---------------------------------------------------------------------------
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const signature = req.headers['crypto-pay-api-signature'];
      const body = JSON.parse(req.body);

      if (!cryptobot.verifyWebhookSignature(body, signature)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      if (body.update_type === 'invoice_paid') {
        await handleInvoicePaid(body.payload);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Webhook error:', err);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

async function handleInvoicePaid(invoice) {
  let payload;
  try { payload = JSON.parse(invoice.payload); } catch { return; }

  const order = await db.findOne('orders', { id: payload.order_id });
  if (!order || !['pending_payment', 'in_progress'].includes(order.status)) return;

  if (order.status === 'pending_payment') {
    await db.updateOne('orders', {
      status:               'in_progress',
      cryptobot_payment_id: invoice.invoice_id,
      paid_at:              new Date().toISOString(),
    }, { id: order.id });
  }

  await notifyViaBot(async (bot) => {
    const buyer = await db.findOne('users', { telegram_id: order.buyer_id });
    const buyerContact = buyer?.username
      ? `@${buyer.username}`
      : `<a href="tg://user?id=${order.buyer_id}">${buyer?.first_name || 'Аноним'}</a>`;

    await bot.telegram.sendMessage(
      order.buyer_id,
      `✅ <b>Оплата получена!</b>\n\nЗаказ #${order.id}: <b>${order.service_title}</b>\n\nПродавец получил уведомление и приступит к работе. Ждите!`,
      { parse_mode: 'HTML' }
    );
    await bot.telegram.sendMessage(
      order.seller_id,
      `🎉 <b>Новый заказ #${order.id}!</b>\n\n` +
      `Услуга: <b>${order.service_title}</b>\n` +
      `Покупатель: ${buyerContact}\n` +
      `Сумма: <b>${order.amount} ${order.currency}</b> (вам: ${order.seller_amount})\n\n` +
      (order.requirements ? `📋 <b>Требования:</b>\n${order.requirements}\n\n` : '') +
      `Выполните заказ, свяжитесь с покупателем и нажмите кнопку ниже:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '✅ Заказ выполнен — уведомить покупателя',
            callback_data: `deliver_${order.id}`,
          }]],
        },
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Create order → get CryptoBot invoice
// ---------------------------------------------------------------------------
router.post('/create/:serviceId', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const serviceId = parseInt(req.params.serviceId);
    const { requirements } = req.body;

    const service = await db.findOne('services', { id: serviceId, status: 'active' });
    if (!service) return res.status(404).json({ error: 'Услуга не найдена или недоступна' });
    if (service.seller_id === id) return res.status(400).json({ error: 'Нельзя заказать у самого себя' });

    const user = await db.findOne('users', { telegram_id: id });
    if (!user) return res.status(401).json({ error: 'Сначала зарегистрируйтесь' });

    // Create a placeholder order to get its ID for the invoice payload
    const seller = await db.findOne('users', { telegram_id: service.seller_id });
    const sellerAmount = parseFloat((service.price * (1 - COMMISSION)).toFixed(8));

    const order = await db.insertOne('orders', {
      service_id:           serviceId,
      buyer_id:             id,
      seller_id:            service.seller_id,
      amount:               service.price,
      currency:             service.currency,
      commission:           parseFloat((service.price * COMMISSION).toFixed(8)),
      seller_amount:        sellerAmount,
      status:               'pending_payment',
      cryptobot_invoice_id: null,
      cryptobot_payment_id: null,
      requirements:         requirements || null,
      service_title:        service.title,
      seller_name:          seller?.first_name || 'Продавец',
      buyer_name:           user.first_name    || 'Покупатель',
      created_at:           new Date().toISOString(),
    });

    let invoice;
    try {
      invoice = await cryptobot.createInvoice({
        asset:       service.currency,
        amount:      service.price,
        description: `Заказ: ${service.title}`,
        payload:     { order_id: order.id },
      });
    } catch (err) {
      // Remove the placeholder order on invoice failure
      await db.query('DELETE FROM orders WHERE id = $1', [order.id]);
      console.error('CryptoBot invoice error:', err.message);
      return res.status(500).json({ error: `Ошибка создания счёта: ${err.message}` });
    }

    await db.updateOne('orders', { cryptobot_invoice_id: invoice.invoice_id }, { id: order.id });

    res.json({
      success:  true,
      order_id: order.id,
      pay_url:  invoice.pay_url,
      amount:   service.price,
      currency: service.currency,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// My orders (enriched with counterpart usernames)
// ---------------------------------------------------------------------------
router.get('/my', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const [asBuyer, asSeller] = await Promise.all([
      db.findMany('orders', { buyer_id:  id }),
      db.findMany('orders', { seller_id: id }),
    ]);

    async function enrich(order) {
      const buyer  = await db.findOne('users', { telegram_id: order.buyer_id  });
      const seller = await db.findOne('users', { telegram_id: order.seller_id });
      return {
        ...order,
        buyer_name:      buyer?.first_name  || 'Покупатель',
        buyer_username:  buyer?.username    || null,
        seller_name:     seller?.first_name || 'Продавец',
        seller_username: seller?.username   || null,
      };
    }

    res.json({
      as_buyer:  await Promise.all(asBuyer.map(enrich)),
      as_seller: await Promise.all(asSeller.map(enrich)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Single order
// ---------------------------------------------------------------------------
router.get('/:id', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.buyer_id !== id && order.seller_id !== id)
      return res.status(403).json({ error: 'Нет доступа' });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Manual payment check (fallback when webhook not configured)
// ---------------------------------------------------------------------------
router.post('/:id/check-payment', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.buyer_id !== id) return res.status(403).json({ error: 'Нет доступа' });
    if (order.status !== 'pending_payment') return res.json({ status: order.status });

    const invoice = await cryptobot.getInvoice(order.cryptobot_invoice_id);
    if (invoice?.status === 'paid') {
      await handleInvoicePaid({
        invoice_id: invoice.invoice_id,
        payload:    JSON.stringify({ order_id: order.id }),
      });
      return res.json({ status: 'in_progress' });
    }
    res.json({ status: 'pending_payment' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка проверки оплаты' });
  }
});

// ---------------------------------------------------------------------------
// Seller marks order as delivered
// ---------------------------------------------------------------------------
router.post('/:id/deliver', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
    if (order.status !== 'in_progress')
      return res.status(400).json({ error: 'Нельзя отметить в текущем статусе' });

    await db.updateOne('orders', {
      status:       'delivered',
      delivered_at: new Date().toISOString(),
    }, { id: order.id });

    const seller = await db.findOne('users', { telegram_id: id });
    await notifyViaBot(async (bot) => {
      await bot.telegram.sendMessage(
        order.buyer_id,
        `📦 <b>Заказ #${order.id} выполнен!</b>\n\n` +
        `Услуга: <b>${order.service_title}</b>\n` +
        `Исполнитель: ${seller?.first_name || 'Исполнитель'}\n\n` +
        `Проверь результат и подтверди получение:`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Принять и оплатить', callback_data: `confirm_${order.id}` },
              { text: '❌ Открыть спор',       callback_data: `dispute_${order.id}` },
            ]],
          },
        }
      );
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Buyer confirms delivery → transfer to seller
// ---------------------------------------------------------------------------
router.post('/:id/confirm', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { rating, comment } = req.body;
    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.buyer_id !== id) return res.status(403).json({ error: 'Нет доступа' });
    if (!['in_progress', 'delivered'].includes(order.status))
      return res.status(400).json({ error: 'Нельзя подтвердить в текущем статусе' });

    try {
      await cryptobot.transfer({
        userId:  order.seller_id,
        asset:   order.currency,
        amount:  order.seller_amount,
        spendId: `order_${order.id}`,
        comment: `Оплата за заказ #${order.id}: ${order.service_title}`,
      });
    } catch (err) {
      console.error('Transfer error:', err.message);
      return res.status(500).json({ error: 'Ошибка перевода. Убедитесь, что продавец запустил @CryptoBot.' });
    }

    await db.updateOne('orders', {
      status:       'completed',
      completed_at: new Date().toISOString(),
    }, { id: order.id });

    if (rating && parseInt(rating) >= 1 && parseInt(rating) <= 5) {
      await db.insertOne('reviews', {
        order_id:    order.id,
        reviewer_id: id,
        seller_id:   order.seller_id,
        rating:      parseInt(rating),
        comment:     comment || null,
        created_at:  new Date().toISOString(),
      });
    }

    await notifyViaBot(async (bot) => {
      await bot.telegram.sendMessage(
        order.seller_id,
        `🎉 <b>Заказ #${order.id} завершён!</b>\n\n` +
        `<b>${order.seller_amount} ${order.currency}</b> переведены вам через @CryptoBot.\n` +
        (rating ? `⭐ Оценка: ${rating}/5` : ''),
        { parse_mode: 'HTML' }
      );
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Open dispute
// ---------------------------------------------------------------------------
router.post('/:id/dispute', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { reason } = req.body;
    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.buyer_id !== id && order.seller_id !== id)
      return res.status(403).json({ error: 'Нет доступа' });
    if (!['in_progress', 'delivered'].includes(order.status))
      return res.status(400).json({ error: 'Нельзя открыть спор в текущем статусе' });

    await db.updateOne('orders', {
      status:         'disputed',
      dispute_reason: reason || null,
      disputed_at:    new Date().toISOString(),
    }, { id: order.id });

    await notifyViaBot(async (bot) => {
      const adminIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
      for (const adminId of adminIds) {
        await bot.telegram.sendMessage(
          adminId,
          `🚨 <b>Спор по заказу #${order.id}</b>\n\n` +
          `Услуга: ${order.service_title}\n` +
          `Покупатель ID: ${order.buyer_id}\n` +
          `Продавец ID: ${order.seller_id}\n` +
          `Сумма: ${order.amount} ${order.currency}\n` +
          (reason ? `\nПричина: ${reason}` : ''),
          { parse_mode: 'HTML' }
        );
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
