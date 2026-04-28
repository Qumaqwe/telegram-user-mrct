const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { validateTelegramData } = require('../middleware/auth');
const { createContentLimiter } = require('../middleware/rateLimit');

const CATEGORIES = ['design', 'dev', 'copywriting', 'marketing', 'translation', 'video', 'other'];
const COMMISSION = 0.05;
const MAX_ACTIVE_SERVICES = 10;

async function enrichService(s) {
  const seller  = await db.findOne('users', { telegram_id: s.seller_id });
  const reviews = await db.findMany('reviews', { seller_id: s.seller_id }, 'created_at DESC');
  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  return {
    ...s,
    seller_name:     seller?.first_name || 'Пользователь',
    seller_username: seller?.username   || null,
    rating:          avgRating ? parseFloat(avgRating) : null,
    reviews_count:   reviews.length,
    commission:      COMMISSION,
  };
}

router.get('/', async (req, res) => {
  try {
    const { search, category, sort = 'newest' } = req.query;
    let services = await db.findMany('services', { status: 'active' });
    services = await Promise.all(services.map(enrichService));

    if (search) {
      const q = search.toLowerCase();
      services = services.filter(
        (s) => s.title.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
      );
    }
    if (category && CATEGORIES.includes(category)) {
      services = services.filter((s) => s.category === category);
    }
    if (sort === 'price_asc')       services.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') services.sort((a, b) => b.price - a.price);
    else if (sort === 'rating')     services.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else services.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(services);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const service = await db.findOne('services', { id: parseInt(req.params.id) });
    if (!service || service.status === 'deleted')
      return res.status(404).json({ error: 'Услуга не найдена' });

    const reviews = await db.findMany('reviews', { seller_id: service.seller_id });
    const enrichedReviews = await Promise.all(
      reviews.map(async (r) => {
        const reviewer = await db.findOne('users', { telegram_id: r.reviewer_id });
        return { ...r, reviewer_name: reviewer?.first_name || 'Аноним' };
      })
    );

    const enriched = await enrichService(service);
    res.json({ ...enriched, reviews: enrichedReviews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/', validateTelegramData, createContentLimiter, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const { title, description, category, price, currency = 'TON', delivery_days } = req.body;

    if (!title || !category || !price || !delivery_days)
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    if (title.length < 5 || title.length > 100)
      return res.status(400).json({ error: 'Заголовок: 5–100 символов' });
    if (description && description.length > 2000)
      return res.status(400).json({ error: 'Описание: не более 2000 символов' });
    if (!CATEGORIES.includes(category))
      return res.status(400).json({ error: 'Неверная категория' });
    if (!['TON', 'USDT'].includes(currency))
      return res.status(400).json({ error: 'Валюта: TON или USDT' });

    const priceNum = parseFloat(price);
    const minPrice = currency === 'USDT' ? 2 : 1;
    if (isNaN(priceNum) || priceNum < minPrice)
      return res.status(400).json({ error: `Минимальная цена: ${minPrice} ${currency} (ограничение CryptoBot — мин. перевод $1)` });

    const daysNum = parseInt(delivery_days);
    if (isNaN(daysNum) || daysNum < 1 || daysNum > 90)
      return res.status(400).json({ error: 'Срок выполнения: 1–90 дней' });

    if (!await db.findOne('users', { telegram_id: id }))
      return res.status(401).json({ error: 'Сначала зарегистрируйтесь' });

    const activeCount = await db.count('services', { seller_id: id, status: 'active' });
    if (activeCount >= MAX_ACTIVE_SERVICES)
      return res.status(400).json({ error: `Нельзя иметь более ${MAX_ACTIVE_SERVICES} активных услуг` });

    const service = await db.insertOne('services', {
      seller_id:     id,
      title,
      description:   description || null,
      category,
      price:         priceNum,
      currency,
      delivery_days: daysNum,
      status:        'active',
      created_at:    new Date().toISOString(),
    });
    res.json({ success: true, service });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', validateTelegramData, async (req, res) => {
  try {
    const { id } = req.telegramUser;
    const service = await db.findOne('services', { id: parseInt(req.params.id) });
    if (!service) return res.status(404).json({ error: 'Услуга не найдена' });
    if (service.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
    if (service.status === 'deleted') return res.status(400).json({ error: 'Уже удалено' });
    await db.updateOne('services', { status: 'deleted' }, { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
