const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramData } = require('../middleware/auth');
const { createContentLimiter } = require('../middleware/rateLimit');
const { logger } = require('../utils');

const MAX_ACTIVE_LISTINGS = 10;

router.get('/', validateTelegramData, async (req, res) => {
  try {
    const { search, sort = 'newest', minPrice, maxPrice } = req.query;
    let listings = await db.findMany('listings', { status: 'active' });

    listings = await Promise.all(
      listings.map(async (l) => {
        const seller = await db.findOne('users', { telegram_id: l.seller_id });
        return { ...l, first_name: seller?.first_name || null, seller_username: seller?.username || null };
      })
    );

    if (search)   listings = listings.filter((l) => l.username.toLowerCase().includes(search.toLowerCase()));
    if (minPrice) listings = listings.filter((l) => l.price >= parseInt(minPrice));
    if (maxPrice) listings = listings.filter((l) => l.price <= parseInt(maxPrice));

    if (sort === 'price_asc')       listings.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') listings.sort((a, b) => b.price - a.price);
    else listings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(listings);
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id', validateTelegramData, async (req, res) => {
  try {
    const listing = await db.findOne('listings', { id: parseInt(req.params.id) });
    if (!listing) return res.status(404).json({ error: 'Объявление не найдено' });
    const seller = await db.findOne('users', { telegram_id: listing.seller_id });
    res.json({ ...listing, first_name: seller?.first_name || null, seller_username: seller?.username || null });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/', validateTelegramData, createContentLimiter, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { username, description, price } = req.body;

    if (!username || !price) return res.status(400).json({ error: 'Укажите юзернейм и цену' });

    const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
    if (!usernameRegex.test(username))
      return res.status(400).json({ error: 'Неверный формат юзернейма. 5–32 символа, только буквы, цифры и _' });

    if (description && description.length > 500)
      return res.status(400).json({ error: 'Описание: не более 500 символов' });

    const priceNum = parseInt(price);
    if (isNaN(priceNum) || priceNum < 1 || priceNum > 1_000_000)
      return res.status(400).json({ error: 'Цена: от 1 до 1 000 000 звёзд' });

    const exists = await db.findOne('listings', { username: username.toLowerCase(), status: 'active' });
    if (exists) return res.status(409).json({ error: 'Этот юзернейм уже выставлен на продажу' });

    if (!await db.findOne('users', { telegram_id: id }))
      return res.status(401).json({ error: 'Сначала зарегистрируйтесь' });

    const activeCount = await db.count('listings', { seller_id: id, status: 'active' });
    if (activeCount >= MAX_ACTIVE_LISTINGS)
      return res.status(400).json({ error: `Нельзя иметь более ${MAX_ACTIVE_LISTINGS} активных объявлений` });

    const listing = await db.insertOne('listings', {
      seller_id:   id,
      username:    username.toLowerCase(),
      description: description || null,
      price:       priceNum,
      status:      'active',
      created_at:  new Date().toISOString(),
    });
    res.json({ success: true, listing });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const listing = await db.findOne('listings', { id: parseInt(req.params.id) });
    if (!listing) return res.status(404).json({ error: 'Объявление не найдено' });
    if (listing.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
    if (listing.status !== 'active') return res.status(400).json({ error: 'Нельзя удалить это объявление' });
    await db.updateOne('listings', { status: 'cancelled' }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    logger.error('Route error', { msg: err.message });
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
