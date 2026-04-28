const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramData, requireAdmin } = require('../middleware/auth');
const { escapeHtml, notifyViaBot, logger } = require('../utils');

router.use(validateTelegramData, requireAdmin);

router.get('/stats', async (req, res) => {
  try {
    const [users, services, orders] = await Promise.all([
      db.findMany('users',    {}),
      db.findMany('services', {}),
      db.findMany('orders',   {}),
    ]);

    const completed  = orders.filter((o) => o.status === 'completed');
    const volume     = completed.reduce((s, o) => s + o.amount,     0);
    const commission = completed.reduce((s, o) => s + o.commission, 0);

    res.json({
      users:    { total: users.length },
      services: {
        active:  services.filter((s) => s.status === 'active').length,
        deleted: services.filter((s) => s.status === 'deleted').length,
      },
      orders: {
        total:           orders.length,
        pending_payment: orders.filter((o) => o.status === 'pending_payment').length,
        in_progress:     orders.filter((o) => o.status === 'in_progress').length,
        delivered:       orders.filter((o) => o.status === 'delivered').length,
        completed:       completed.length,
        disputed:        orders.filter((o) => o.status === 'disputed').length,
      },
      financials: {
        volume:            parseFloat(volume.toFixed(4)),
        commission_earned: parseFloat(commission.toFixed(4)),
      },
    });
  } catch (err) {
    console.error(err);
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const orders = await db.findMany('orders', {});
    res.json(orders);
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/services', async (req, res) => {
  try {
    const services = await db.findMany('services', {});
    const enriched = await Promise.all(services.map(async (s) => {
      const seller = await db.findOne('users', { telegram_id: s.seller_id });
      return { ...s, seller_name: seller?.first_name, seller_username: seller?.username };
    }));
    res.json(enriched);
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/services/:id', async (req, res) => {
  try {
    const service = await db.findOne('services', { id: parseInt(req.params.id) });
    if (!service) return res.status(404).json({ error: 'Не найдено' });
    await db.updateOne('services', { status: 'deleted' }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await db.findMany('users', {});
    const enriched = await Promise.all(users.map(async (u) => ({
      ...u,
      services_count: await db.count('services', { seller_id: u.telegram_id }),
      orders_count:   await db.count('orders',   { buyer_id:  u.telegram_id }),
    })));
    res.json(enriched);
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/orders/:id/refund', async (req, res) => {
  try {
    const order = await db.findOne('orders', { id: parseInt(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    if (order.status !== 'disputed') return res.status(400).json({ error: 'Заказ не в статусе спора' });

    const cryptobot = require('../cryptobot');
    try {
      await cryptobot.transfer({
        userId:  order.buyer_id,
        asset:   order.currency,
        amount:  order.amount,
        spendId: `refund_${order.id}`,
        comment: `Возврат по заказу #${order.id}`,
      });
    } catch (err) {
      logger.error('Refund transfer error', { msg: err.message });
      return res.status(500).json({ error: `Ошибка перевода: ${err.message}` });
    }

    await db.updateOne('orders', {
      status:      'refunded',
      refunded_at: new Date().toISOString(),
    }, { id: order.id });

    await notifyViaBot(async (bot) => {
      await bot.telegram.sendMessage(
        order.buyer_id,
        `✅ <b>Возврат по заказу #${order.id}</b>\n\n` +
        `Услуга: <b>${escapeHtml(order.service_title)}</b>\n` +
        `Сумма: <b>${order.amount} ${escapeHtml(order.currency)}</b>\n\n` +
        `Средства переведены на ваш @CryptoBot кошелёк.`,
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
