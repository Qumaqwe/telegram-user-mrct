const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramData } = require('../middleware/auth');

router.post('/register', validateTelegramData, async (req, res) => {
  const { id, username, first_name, last_name } = req.telegramUser;
  try {
    await db.query(
      `INSERT INTO users (telegram_id, username, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE
         SET username = $2, first_name = $3, last_name = $4`,
      [id, username || null, first_name || null, last_name || null]
    );
    const user = await db.findOne('users', { telegram_id: id });
    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/me', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const user = await db.findOne('users', { telegram_id: id });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const [myServices, orders, incomingOrders, reviews] = await Promise.all([
      db.findMany('services', { seller_id: id }),
      db.findMany('orders',   { buyer_id:  id }),
      db.findMany('orders',   { seller_id: id }),
      db.findMany('reviews',  { seller_id: id }, 'created_at DESC'),
    ]);

    const avgRating = reviews.length
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null;

    const earned = incomingOrders
      .filter((o) => o.status === 'completed')
      .reduce((s, o) => s + (o.seller_amount || 0), 0);

    res.json({
      user,
      services: myServices,
      orders,
      incoming_orders: incomingOrders,
      rating: avgRating ? parseFloat(avgRating) : null,
      reviews_count: reviews.length,
      earned: parseFloat(earned.toFixed(4)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
