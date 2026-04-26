const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramData } = require('../middleware/auth');

router.post('/register', validateTelegramData, (req, res) => {
  const { id, username, first_name, last_name } = req.telegramUser;
  try {
    const existing = db.get('users').find({ telegram_id: id }).value();
    if (existing) {
      db.get('users').find({ telegram_id: id }).assign({
        username: username || null,
        first_name: first_name || null,
        last_name: last_name || null,
      }).write();
    } else {
      db.get('users').push({
        telegram_id: id,
        username: username || null,
        first_name: first_name || null,
        last_name: last_name || null,
        created_at: new Date().toISOString(),
      }).write();
    }
    res.json({ success: true, user: db.get('users').find({ telegram_id: id }).value() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/me', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const user = db.get('users').find({ telegram_id: id }).value();
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const myServices = db.get('services').filter({ seller_id: id }).value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const orders = db.get('orders').filter({ buyer_id: id }).value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const incomingOrders = db.get('orders').filter({ seller_id: id }).value()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const reviews = db.get('reviews').filter({ seller_id: id }).value();
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  const earned = incomingOrders
    .filter((o) => o.status === 'completed')
    .reduce((s, o) => s + o.seller_amount, 0);

  res.json({
    user,
    services: myServices,
    orders,
    incoming_orders: incomingOrders,
    rating: avgRating ? parseFloat(avgRating) : null,
    reviews_count: reviews.length,
    earned: parseFloat(earned.toFixed(4)),
  });
});

module.exports = router;
