const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramData } = require('../middleware/auth');

router.post('/buy/:listingId', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const listingId = parseInt(req.params.listingId);

  const listing = db.get('listings').find({ id: listingId, status: 'active' }).value();
  if (!listing) return res.status(404).json({ error: 'Объявление не найдено или уже продано' });
  if (listing.seller_id === id) return res.status(400).json({ error: 'Нельзя купить у самого себя' });

  const pendingTx = db.get('transactions').find({ listing_id: listingId, status: 'pending' }).value();
  if (pendingTx) return res.status(409).json({ error: 'Уже есть ожидающая транзакция' });

  const txId = db.getNextTransactionId();
  db.get('transactions').push({
    id: txId, listing_id: listingId, buyer_id: id, seller_id: listing.seller_id,
    amount: listing.price, status: 'pending', stars_payment_id: null,
    created_at: new Date().toISOString(),
  }).write();

  res.json({ success: true, transaction_id: txId, amount: listing.price, username: listing.username });
});

router.get('/status/:transactionId', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const tx = db.get('transactions').find({ id: parseInt(req.params.transactionId) }).value();
  if (!tx) return res.status(404).json({ error: 'Транзакция не найдена' });
  if (tx.buyer_id !== id && tx.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
  res.json(tx);
});

module.exports = router;
