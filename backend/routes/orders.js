const express = require('express');
const router = express.Router();
const db = require('../database');
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

// CryptoBot webhook — no auth, raw body for signature check
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

  const order = db.get('orders').find({ id: payload.order_id, status: 'pending_payment' }).value();
  if (!order) return;

  db.get('orders').find({ id: order.id }).assign({
    status: 'in_progress',
    cryptobot_payment_id: invoice.invoice_id,
    paid_at: new Date().toISOString(),
  }).write();

  await notifyViaBot(async (bot) => {
    const buyer  = db.get('users').find({ telegram_id: order.buyer_id }).value();
    const seller = db.get('users').find({ telegram_id: order.seller_id }).value();

    await bot.telegram.sendMessage(
      order.buyer_id,
      `✅ <b>Оплата получена!</b>\n\nЗаказ #${order.id}: <b>${order.service_title}</b>\n\nПродавец получил уведомление и приступит к работе. Ждите!`,
      { parse_mode: 'HTML' }
    );
    await bot.telegram.sendMessage(
      order.seller_id,
      `🎉 <b>Новый заказ #${order.id}!</b>\n\n` +
      `Услуга: <b>${order.service_title}</b>\n` +
      `Покупатель: ${buyer?.first_name || 'Аноним'}\n` +
      `Сумма: <b>${order.amount} ${order.currency}</b> (вам: ${order.seller_amount})\n\n` +
      (order.requirements ? `📋 <b>Требования:</b>\n${order.requirements}\n\n` : '') +
      `Выполните заказ и нажмите кнопку ниже:`,
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

// Create order → get CryptoBot invoice
router.post('/create/:serviceId', validateTelegramData, async (req, res) => {
  const { id } = req.telegramUser;
  const serviceId = parseInt(req.params.serviceId);
  const { requirements } = req.body;

  const service = db.get('services').find({ id: serviceId, status: 'active' }).value();
  if (!service) return res.status(404).json({ error: 'Услуга не найдена или недоступна' });
  if (service.seller_id === id) return res.status(400).json({ error: 'Нельзя заказать у самого себя' });

  const user = db.get('users').find({ telegram_id: id }).value();
  if (!user) return res.status(401).json({ error: 'Сначала зарегистрируйтесь' });

  const orderId = db.getNextOrderId();

  let invoice;
  try {
    invoice = await cryptobot.createInvoice({
      asset: service.currency,
      amount: service.price,
      description: `Заказ: ${service.title}`,
      payload: { order_id: orderId },
    });
  } catch (err) {
    console.error('CryptoBot invoice error:', err.message);
    return res.status(500).json({ error: 'Ошибка создания счёта. Проверьте CRYPTOBOT_TOKEN.' });
  }

  const seller = db.get('users').find({ telegram_id: service.seller_id }).value();
  const sellerAmount = parseFloat((service.price * (1 - COMMISSION)).toFixed(8));

  db.get('orders').push({
    id: orderId,
    service_id: serviceId,
    buyer_id: id,
    seller_id: service.seller_id,
    amount: service.price,
    currency: service.currency,
    commission: parseFloat((service.price * COMMISSION).toFixed(8)),
    seller_amount: sellerAmount,
    status: 'pending_payment',
    cryptobot_invoice_id: invoice.invoice_id,
    cryptobot_payment_id: null,
    requirements: requirements || null,
    service_title: service.title,
    seller_name: seller?.first_name || 'Продавец',
    buyer_name: user.first_name || 'Покупатель',
    created_at: new Date().toISOString(),
    paid_at: null,
    completed_at: null,
  }).write();

  res.json({
    success: true,
    order_id: orderId,
    pay_url: invoice.pay_url,
    amount: service.price,
    currency: service.currency,
  });
});

// My orders
router.get('/my', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const asBuyer  = db.get('orders').filter({ buyer_id: id }).value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const asSeller = db.get('orders').filter({ seller_id: id }).value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ as_buyer: asBuyer, as_seller: asSeller });
});

// Single order
router.get('/:id', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const order = db.get('orders').find({ id: parseInt(req.params.id) }).value();
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (order.buyer_id !== id && order.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
  res.json(order);
});

// Manual payment check (fallback when webhook not set up)
router.post('/:id/check-payment', validateTelegramData, async (req, res) => {
  const { id } = req.telegramUser;
  const order = db.get('orders').find({ id: parseInt(req.params.id) }).value();
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (order.buyer_id !== id) return res.status(403).json({ error: 'Нет доступа' });
  if (order.status !== 'pending_payment') return res.json({ status: order.status });

  try {
    const invoice = await cryptobot.getInvoice(order.cryptobot_invoice_id);
    if (invoice?.status === 'paid') {
      db.get('orders').find({ id: order.id }).assign({
        status: 'in_progress',
        cryptobot_payment_id: invoice.invoice_id,
        paid_at: new Date().toISOString(),
      }).write();
      await handleInvoicePaid({ ...invoice, payload: JSON.stringify({ order_id: order.id }) });
      return res.json({ status: 'in_progress' });
    }
    res.json({ status: 'pending_payment' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка проверки оплаты' });
  }
});

// Buyer confirms delivery → transfer to seller
router.post('/:id/confirm', validateTelegramData, async (req, res) => {
  const { id } = req.telegramUser;
  const { rating, comment } = req.body;
  const order = db.get('orders').find({ id: parseInt(req.params.id) }).value();
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (order.buyer_id !== id) return res.status(403).json({ error: 'Нет доступа' });
  if (!['in_progress', 'delivered'].includes(order.status))
    return res.status(400).json({ error: 'Нельзя подтвердить в текущем статусе' });

  try {
    await cryptobot.transfer({
      userId: order.seller_id,
      asset: order.currency,
      amount: order.seller_amount,
      spendId: `order_${order.id}`,
      comment: `Оплата за заказ #${order.id}: ${order.service_title}`,
    });
  } catch (err) {
    console.error('Transfer error:', err.message);
    return res.status(500).json({ error: 'Ошибка перевода. Убедитесь, что продавец запустил @CryptoBot.' });
  }

  db.get('orders').find({ id: order.id }).assign({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).write();

  if (rating && parseInt(rating) >= 1 && parseInt(rating) <= 5) {
    db.get('reviews').push({
      id: db.getNextReviewId(),
      order_id: order.id,
      reviewer_id: id,
      seller_id: order.seller_id,
      rating: parseInt(rating),
      comment: comment || null,
      created_at: new Date().toISOString(),
    }).write();
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
});

// Open dispute
router.post('/:id/dispute', validateTelegramData, async (req, res) => {
  const { id } = req.telegramUser;
  const { reason } = req.body;
  const order = db.get('orders').find({ id: parseInt(req.params.id) }).value();
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (order.buyer_id !== id && order.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
  if (!['in_progress', 'delivered'].includes(order.status))
    return res.status(400).json({ error: 'Нельзя открыть спор в текущем статусе' });

  db.get('orders').find({ id: order.id }).assign({
    status: 'disputed',
    dispute_reason: reason || null,
    disputed_at: new Date().toISOString(),
  }).write();

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
});

module.exports = router;
