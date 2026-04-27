const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramData } = require('../middleware/auth');

router.post('/buy/:listingId', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const listingId = parseInt(req.params.listingId);

    const listing = await db.findOne('listings', { id: listingId, status: 'active' });
    if (!listing) return res.status(404).json({ error: 'Объявление не найдено или уже продано' });
    if (listing.seller_id === id) return res.status(400).json({ error: 'Нельзя купить у самого себя' });

    const pendingTx = await db.findOne('transactions', { listing_id: listingId, status: 'pending' });
    if (pendingTx) return res.status(409).json({ error: 'Уже есть ожидающая транзакция' });

    const tx = await db.insertOne('transactions', {
      listing_id:       listingId,
      buyer_id:         id,
      seller_id:        listing.seller_id,
      amount:           listing.price,
      status:           'pending',
      stars_payment_id: null,
      created_at:       new Date().toISOString(),
    });

    res.json({ success: true, transaction_id: tx.id, amount: listing.price, username: listing.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/status/:transactionId', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const tx = await db.findOne('transactions', { id: parseInt(req.params.transactionId) });
    if (!tx) return res.status(404).json({ error: 'Транзакция не найдена' });
    if (tx.buyer_id !== id && tx.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
    res.json(tx);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
