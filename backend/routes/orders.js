const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramData } = require('../middleware/auth');
const cryptobot = require('../cryptobot');
const {
  escapeHtml,
  notifyViaBot,
  logger,
  cryptobotSellerOrderPaidHintHtml,
  isCryptobotUserMissingError,
  notifySellerCryptobotRequiredForPayout,
} = require('../utils');
const { completeOrder } = require('../escrow');
const { createOrderLimiter, checkPaymentLimiter } = require('../middleware/rateLimit');

const COMMISSION = 0.05;

// ---------------------------------------------------------------------------
// CryptoBot webhook — no auth, raw body for signature check
// ---------------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['crypto-pay-api-signature'];
    const rawBody   = req.body; // Buffer — provided by selective parser in index.js

    if (!cryptobot.verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = JSON.parse(rawBody);
    if (body.update_type === 'invoice_paid') {
      await handleInvoicePaid(body.payload);
    }
    res.json({ ok: true });
    } catch (err) {
      logger.error('Webhook processing error', { msg: err.message });
      res.status(500).json({ error: 'Webhook processing failed' });
    }
});

async function handleInvoicePaid(invoice) {
  let payload;
  try { payload = JSON.parse(invoice.payload); } catch { return; }

  const order = await db.findOne('orders', { id: payload.order_id });
  if (!order || !['pending_payment', 'in_progress'].includes(order.status)) return;

  // Only transition and notify if the order hasn't been paid yet.
  // A duplicate webhook for an already in_progress order is silently ignored.
  if (order.status !== 'pending_payment') return;

  await db.updateOne('orders', {
    status:               'in_progress',
    cryptobot_payment_id: invoice.invoice_id,
    paid_at:              new Date().toISOString(),
  }, { id: order.id });

  await notifyViaBot(async (bot) => {
    const buyer = await db.findOne('users', { telegram_id: order.buyer_id });
    const buyerContact = buyer?.username
      ? `@${escapeHtml(buyer.username)}`
      : `<a href="tg://user?id=${order.buyer_id}">${escapeHtml(buyer?.first_name || 'Аноним')}</a>`;

    await bot.telegram.sendMessage(
      order.buyer_id,
      `✅ <b>Оплата получена!</b>\n\nЗаказ #${order.id}: <b>${escapeHtml(order.service_title)}</b>\n\nПродавец получил уведомление и приступит к работе. Ждите!`,
      { parse_mode: 'HTML' }
    );
    await bot.telegram.sendMessage(
      order.seller_id,
      `🎉 <b>Новый заказ #${order.id}!</b>\n\n` +
      `Услуга: <b>${escapeHtml(order.service_title)}</b>\n` +
      `Покупатель: ${buyerContact}\n` +
      `Сумма: <b>${order.amount} ${escapeHtml(order.currency)}</b> (вам: ${order.seller_amount})\n\n` +
      (order.requirements ? `📋 <b>Требования:</b>\n${escapeHtml(order.requirements)}\n\n` : '') +
      cryptobotSellerOrderPaidHintHtml() +
      `\n\nВыполните заказ, свяжитесь с покупателем и нажмите кнопку ниже:`,
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
router.post('/create/:serviceId', validateTelegramData, createOrderLimiter, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const serviceId = parseInt(req.params.serviceId);
    const { requirements } = req.body;

    if (requirements && requirements.length > 2000)
      return res.status(400).json({ error: 'Требования к заказу: не более 2000 символов' });

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
      delivery_days:        service.delivery_days,
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
      logger.error('CryptoBot invoice error', { msg: err.message });
      return res.status(500).json({ error: `Ошибка создания счёта: ${err.message}` });
    }

    await db.updateOne('orders', {
      cryptobot_invoice_id: invoice.invoice_id,
      pay_url:              invoice.pay_url,
    }, { id: order.id });

    res.json({
      success:  true,
      order_id: order.id,
      pay_url:  invoice.pay_url,
      amount:   service.price,
      currency: service.currency,
    });
  } catch (err) {
    logger.error('Create order error', { msg: err.message });
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
      const review = order.status === 'completed'
        ? await db.findOne('reviews', { order_id: order.id })
        : null;
      return {
        ...order,
        buyer_name:      buyer?.first_name  || 'Покупатель',
        buyer_username:  buyer?.username    || null,
        seller_name:     seller?.first_name || 'Продавец',
        seller_username: seller?.username   || null,
        has_review:      !!review,
        review:          review || null,
      };
    }

    res.json({
      as_buyer:  await Promise.all(asBuyer.map(enrich)),
      as_seller: await Promise.all(asSeller.map(enrich)),
    });
  } catch (err) {
    logger.error('My orders error', { msg: err.message });
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
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Manual payment check (fallback when webhook not configured)
// ---------------------------------------------------------------------------
router.post('/:id/check-payment', validateTelegramData, checkPaymentLimiter, async (req, res) => {
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
    logger.error('Route error', { msg: err.message });
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
        `Услуга: <b>${escapeHtml(order.service_title)}</b>\n` +
        `Исполнитель: ${escapeHtml(seller?.first_name || 'Исполнитель')}\n\n` +
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
    logger.error('Route error', { msg: err.message });
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
      await completeOrder(order.id, { rating, comment });
    } catch (err) {
      logger.error('Transfer error (API confirm)', { msg: err.message });
      let msg = `Ошибка перевода: ${err.message}`;
      if (err.message.includes('AMOUNT_TOO_SMALL'))
        msg = 'Сумма слишком мала для перевода через CryptoBot (минимум ~$1). Обратитесь к администратору.';
      if (isCryptobotUserMissingError(err)) {
        msg = 'Продавец не запускал @CryptoBot. Попросите его открыть t.me/CryptoBot и нажать «Старт», затем подтвердите заказ снова.';
        if (!order.payout_cryptobot_notice_at) {
          await notifySellerCryptobotRequiredForPayout(order.seller_id, { orderId: order.id });
          await db.updateOne(
            'orders',
            { payout_cryptobot_notice_at: new Date().toISOString() },
            { id: order.id }
          );
        }
      }
      return res.status(500).json({ error: msg });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
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

    if (reason && reason.length > 1000)
      return res.status(400).json({ error: 'Причина спора: не более 1000 символов' });

    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.buyer_id !== id)
      return res.status(403).json({ error: 'Открыть спор может только покупатель' });
    if (!['in_progress', 'delivered'].includes(order.status))
      return res.status(400).json({ error: 'Нельзя открыть спор в текущем статусе' });

    await db.updateOne('orders', {
      status:         'disputed',
      dispute_reason: reason || null,
      disputed_at:    new Date().toISOString(),
    }, { id: order.id });

    await notifyViaBot(async (bot) => {
      // Подтверждение покупателю
      await bot.telegram.sendMessage(
        order.buyer_id,
        `⚠️ <b>Спор открыт по заказу #${order.id}</b>\n\n` +
        `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
        `Администратор рассмотрит ситуацию и свяжется с вами в ближайшее время.` +
        (reason ? `\n\n<b>Ваша причина:</b> ${escapeHtml(reason)}` : ''),
        { parse_mode: 'HTML' }
      ).catch(() => {});

      // Уведомление продавцу
      await bot.telegram.sendMessage(
        order.seller_id,
        `⚠️ <b>Покупатель открыл спор по заказу #${order.id}</b>\n\n` +
        `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
        `Администратор рассмотрит ситуацию и свяжется с вами. ` +
        `Пожалуйста, не предпринимайте действий вне платформы.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      // Уведомление администраторам
      const adminIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
      for (const adminId of adminIds) {
        await bot.telegram.sendMessage(
          adminId,
          `🚨 <b>Спор по заказу #${order.id}</b>\n\n` +
          `Услуга: ${escapeHtml(order.service_title)}\n` +
          `Покупатель ID: ${order.buyer_id}\n` +
          `Продавец ID: ${order.seller_id}\n` +
          `Сумма: ${order.amount} ${escapeHtml(order.currency)}\n` +
          (reason ? `\nПричина: ${escapeHtml(reason)}\n` : '') +
          `\nДля возврата средств: /cancel ${order.id}`,
          { parse_mode: 'HTML' }
        );
      }
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Buyer cancels unpaid order
// ---------------------------------------------------------------------------
router.post('/:id/cancel', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const order = await db.findOne('orders', { id: parseInt(req.params.id) });

    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.buyer_id !== id) return res.status(403).json({ error: 'Нет доступа' });
    if (order.status !== 'pending_payment')
      return res.status(400).json({
        error: 'Отменить можно только неоплаченный заказ. Если заказ уже оплачен — откройте спор.',
      });

    await db.updateOne('orders', {
      status:       'cancelled',
      cancelled_at: new Date().toISOString(),
    }, { id: order.id });

    // Notify buyer with hint to report if something was wrong
    await notifyViaBot(async (bot) => {
      await bot.telegram.sendMessage(
        order.buyer_id,
        `❌ <b>Заказ #${order.id} отменён.</b>\n\n` +
        `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
        `Если у вас были проблемы с продавцом или его услуга нарушает правила — сообщите нам:\n/report`,
        { parse_mode: 'HTML' }
      );
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------------------------------------------------------------------------
// Leave review for a completed order (post-completion, one review per order)
// ---------------------------------------------------------------------------
router.post('/:id/review', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { rating, comment } = req.body;

    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.buyer_id !== id) return res.status(403).json({ error: 'Оставить отзыв может только покупатель' });
    if (order.status !== 'completed') return res.status(400).json({ error: 'Отзыв можно оставить только для завершённого заказа' });

    const parsedRating = parseInt(rating);
    if (!parsedRating || parsedRating < 1 || parsedRating > 5)
      return res.status(400).json({ error: 'Оценка: число от 1 до 5' });

    if (comment && comment.length > 500)
      return res.status(400).json({ error: 'Комментарий: не более 500 символов' });

    // One review per order
    const existing = await db.findOne('reviews', { order_id: order.id });
    if (existing) return res.status(409).json({ error: 'Вы уже оставили отзыв на этот заказ' });

    await db.insertOne('reviews', {
      order_id:    order.id,
      reviewer_id: id,
      seller_id:   order.seller_id,
      rating:      parsedRating,
      comment:     comment || null,
      created_at:  new Date().toISOString(),
    });

    // Notify seller
    await notifyViaBot(async (bot) => {
      await bot.telegram.sendMessage(
        order.seller_id,
        `⭐ <b>Новый отзыв на заказ #${order.id}</b>\n\n` +
        `Услуга: <b>${escapeHtml(order.service_title)}</b>\n` +
        `Оценка: <b>${'⭐'.repeat(parsedRating)}</b> (${parsedRating}/5)` +
        (comment ? `\n\n${escapeHtml(comment)}` : ''),
        { parse_mode: 'HTML' }
      );
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
