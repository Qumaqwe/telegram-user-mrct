const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramData, requireAdmin } = require('../middleware/auth');

router.use(validateTelegramData, requireAdmin);

router.get('/stats', (req, res) => {
  const users    = db.get('users').value();
  const services = db.get('services').value();
  const orders   = db.get('orders').value();
  const completed = orders.filter((o) => o.status === 'completed');
  const volume    = completed.reduce((s, o) => s + o.amount, 0);
  const commission = completed.reduce((s, o) => s + o.commission, 0);

  res.json({
    users: { total: users.length },
    services: {
      active:  services.filter((s) => s.status === 'active').length,
      deleted: services.filter((s) => s.status === 'deleted').length,
    },
    orders: {
      total:            orders.length,
      pending_payment:  orders.filter((o) => o.status === 'pending_payment').length,
      in_progress:      orders.filter((o) => o.status === 'in_progress').length,
      delivered:        orders.filter((o) => o.status === 'delivered').length,
      completed:        completed.length,
      disputed:         orders.filter((o) => o.status === 'disputed').length,
    },
    financials: {
      volume: parseFloat(volume.toFixed(4)),
      commission_earned: parseFloat(commission.toFixed(4)),
    },
  });
});

router.get('/orders', (req, res) => {
  const orders = db.get('orders').value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(orders);
});

router.get('/services', (req, res) => {
  const services = db.get('services').value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((s) => {
      const seller = db.get('users').find({ telegram_id: s.seller_id }).value();
      return { ...s, seller_name: seller?.first_name, seller_username: seller?.username };
    });
  res.json(services);
});

router.delete('/services/:id', (req, res) => {
  const service = db.get('services').find({ id: parseInt(req.params.id) }).value();
  if (!service) return res.status(404).json({ error: 'Не найдено' });
  db.get('services').find({ id: parseInt(req.params.id) }).assign({ status: 'deleted' }).write();
  res.json({ success: true });
});

router.get('/users', (req, res) => {
  const users = db.get('users').value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((u) => ({
      ...u,
      services_count: db.get('services').filter({ seller_id: u.telegram_id }).value().length,
      orders_count:   db.get('orders').filter({ buyer_id: u.telegram_id }).value().length,
    }));
  res.json(users);
});

// Resolve dispute: refund buyer
router.post('/orders/:id/refund', async (req, res) => {
  const order = db.get('orders').find({ id: parseInt(req.params.id) }).value();
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (order.status !== 'disputed') return res.status(400).json({ error: 'Заказ не в статусе спора' });

  const cryptobot = require('../cryptobot');
  try {
    await cryptobot.transfer({
      userId: order.buyer_id,
      asset: order.currency,
      amount: order.amount,
      spendId: `refund_${order.id}`,
      comment: `Возврат по заказу #${order.id}`,
    });
  } catch (err) {
    return res.status(500).json({ error: `Ошибка перевода: ${err.message}` });
  }

  db.get('orders').find({ id: order.id }).assign({
    status: 'refunded',
    refunded_at: new Date().toISOString(),
  }).write();

  res.json({ success: true });
});

module.exports = router;
