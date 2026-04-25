const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramData, requireAdmin } = require('../middleware/auth');

router.use(validateTelegramData, requireAdmin);

router.get('/stats', (req, res) => {
  const users        = db.get('users').value();
  const listings     = db.get('listings').value();
  const transactions = db.get('transactions').value();
  const completed    = transactions.filter((t) => t.status === 'completed');

  res.json({
    users: { total: users.length },
    listings: {
      active:    listings.filter((l) => l.status === 'active').length,
      sold:      listings.filter((l) => l.status === 'sold').length,
      cancelled: listings.filter((l) => l.status === 'cancelled').length,
    },
    transactions: {
      completed: completed.length,
      pending:   transactions.filter((t) => t.status === 'pending').length,
      volume:    completed.reduce((s, t) => s + t.amount, 0),
    },
  });
});

router.get('/listings', (req, res) => {
  const listings = db.get('listings').value().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const result = listings.map((l) => {
    const seller = db.get('users').find({ telegram_id: l.seller_id }).value();
    return { ...l, seller_name: seller?.first_name, seller_username: seller?.username };
  });
  res.json(result);
});

router.delete('/listings/:id', (req, res) => {
  const listing = db.get('listings').find({ id: parseInt(req.params.id) }).value();
  if (!listing) return res.status(404).json({ error: 'Не найдено' });
  db.get('listings').find({ id: parseInt(req.params.id) }).assign({ status: 'cancelled' }).write();
  res.json({ success: true });
});

router.get('/users', (req, res) => {
  const users = db.get('users').value().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const result = users.map((u) => ({
    ...u,
    listings_count: db.get('listings').filter({ seller_id: u.telegram_id }).value().length,
    sold_count:     db.get('listings').filter({ seller_id: u.telegram_id, status: 'sold' }).value().length,
  }));
  res.json(result);
});

router.get('/transactions', (req, res) => {
  const txs = db.get('transactions').value().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const result = txs.map((t) => {
    const listing = db.get('listings').find({ id: t.listing_id }).value();
    const buyer   = db.get('users').find({ telegram_id: t.buyer_id }).value();
    const seller  = db.get('users').find({ telegram_id: t.seller_id }).value();
    return { ...t, username: listing?.username, buyer_name: buyer?.first_name, seller_name: seller?.first_name };
  });
  res.json(result);
});

module.exports = router;
