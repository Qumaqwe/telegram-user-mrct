const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramData } = require('../middleware/auth');

// Регистрация / обновление пользователя
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

    const user = db.get('users').find({ telegram_id: id }).value();
    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить профиль пользователя с его объявлениями
router.get('/me', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;

  const user = db.get('users').find({ telegram_id: id }).value();
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const listings = db.get('listings')
    .filter({ seller_id: id })
    .sortBy((l) => -new Date(l.created_at))
    .value();

  const allTransactions = db.get('transactions').filter({ buyer_id: id }).value();
  const purchases = allTransactions.map((t) => {
    const listing = db.get('listings').find({ id: t.listing_id }).value();
    return { ...t, username: listing?.username, price: listing?.price };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ user, listings, purchases });
});

module.exports = router;
