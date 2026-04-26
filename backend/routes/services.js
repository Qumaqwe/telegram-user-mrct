const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramData } = require('../middleware/auth');

const CATEGORIES = ['design', 'dev', 'copywriting', 'marketing', 'translation', 'video', 'other'];
const COMMISSION = 0.05;

function enrichService(s) {
  const seller = db.get('users').find({ telegram_id: s.seller_id }).value();
  const reviews = db.get('reviews').filter({ seller_id: s.seller_id }).value();
  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  return {
    ...s,
    seller_name: seller?.first_name || 'Пользователь',
    seller_username: seller?.username || null,
    rating: avgRating ? parseFloat(avgRating) : null,
    reviews_count: reviews.length,
    commission: COMMISSION,
  };
}

router.get('/', (req, res) => {
  try {
    const { search, category, sort = 'newest' } = req.query;
    let services = db.get('services').filter({ status: 'active' }).value().map(enrichService);

    if (search) {
      const q = search.toLowerCase();
      services = services.filter(
        (s) => s.title.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
      );
    }
    if (category && CATEGORIES.includes(category)) {
      services = services.filter((s) => s.category === category);
    }
    if (sort === 'price_asc')  services.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') services.sort((a, b) => b.price - a.price);
    else if (sort === 'rating')     services.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else services.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(services);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/:id', (req, res) => {
  const service = db.get('services').find({ id: parseInt(req.params.id) }).value();
  if (!service || service.status === 'deleted') return res.status(404).json({ error: 'Услуга не найдена' });

  const reviews = db.get('reviews').filter({ seller_id: service.seller_id }).value().map((r) => {
    const reviewer = db.get('users').find({ telegram_id: r.reviewer_id }).value();
    return { ...r, reviewer_name: reviewer?.first_name || 'Аноним' };
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ ...enrichService(service), reviews });
});

router.post('/', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const { title, description, category, price, currency = 'TON', delivery_days } = req.body;

  if (!title || !category || !price || !delivery_days)
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  if (title.length < 5 || title.length > 100)
    return res.status(400).json({ error: 'Заголовок: 5–100 символов' });
  if (!CATEGORIES.includes(category))
    return res.status(400).json({ error: 'Неверная категория' });
  if (!['TON', 'USDT'].includes(currency))
    return res.status(400).json({ error: 'Валюта: TON или USDT' });

  const priceNum = parseFloat(price);
  if (isNaN(priceNum) || priceNum < 0.1)
    return res.status(400).json({ error: 'Минимальная цена: 0.1 TON / USDT' });

  const daysNum = parseInt(delivery_days);
  if (isNaN(daysNum) || daysNum < 1 || daysNum > 90)
    return res.status(400).json({ error: 'Срок выполнения: 1–90 дней' });

  if (!db.get('users').find({ telegram_id: id }).value())
    return res.status(401).json({ error: 'Сначала зарегистрируйтесь' });

  const service = {
    id: db.getNextServiceId(),
    seller_id: id,
    title,
    description: description || null,
    category,
    price: priceNum,
    currency,
    delivery_days: daysNum,
    status: 'active',
    created_at: new Date().toISOString(),
  };
  db.get('services').push(service).write();
  res.json({ success: true, service });
});

router.delete('/:id', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const service = db.get('services').find({ id: parseInt(req.params.id) }).value();
  if (!service) return res.status(404).json({ error: 'Услуга не найдена' });
  if (service.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
  if (service.status === 'deleted') return res.status(400).json({ error: 'Уже удалено' });
  db.get('services').find({ id: parseInt(req.params.id) }).assign({ status: 'deleted' }).write();
  res.json({ success: true });
});

module.exports = router;
