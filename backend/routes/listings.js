const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramData } = require('../middleware/auth');

// Получить все активные объявления
router.get('/', (req, res) => {
  try {
    const { search, sort = 'newest', minPrice, maxPrice } = req.query;

    let listings = db.get('listings').filter({ status: 'active' }).value();

    // Прикрепляем данные продавца
    listings = listings.map((l) => {
      const seller = db.get('users').find({ telegram_id: l.seller_id }).value();
      return {
        ...l,
        first_name: seller?.first_name || null,
        seller_username: seller?.username || null,
      };
    });

    if (search) {
      listings = listings.filter((l) =>
        l.username.toLowerCase().includes(search.toLowerCase())
      );
    }
    if (minPrice) listings = listings.filter((l) => l.price >= parseInt(minPrice));
    if (maxPrice) listings = listings.filter((l) => l.price <= parseInt(maxPrice));

    if (sort === 'price_asc') listings.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') listings.sort((a, b) => b.price - a.price);
    else listings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(listings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить одно объявление
router.get('/:id', (req, res) => {
  const listing = db.get('listings').find({ id: parseInt(req.params.id) }).value();
  if (!listing) return res.status(404).json({ error: 'Объявление не найдено' });

  const seller = db.get('users').find({ telegram_id: listing.seller_id }).value();
  res.json({
    ...listing,
    first_name: seller?.first_name || null,
    seller_username: seller?.username || null,
  });
});

// Создать объявление
router.post('/', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const { username, description, price } = req.body;

  if (!username || !price) {
    return res.status(400).json({ error: 'Укажите юзернейм и цену' });
  }

  const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({
      error: 'Неверный формат юзернейма. Должен быть 5-32 символа, только буквы, цифры и _',
    });
  }

  const priceNum = parseInt(price);
  if (isNaN(priceNum) || priceNum < 1 || priceNum > 1000000) {
    return res.status(400).json({ error: 'Цена должна быть от 1 до 1,000,000 звёзд' });
  }

  const existing = db.get('listings')
    .find((l) => l.username === username.toLowerCase() && l.status === 'active')
    .value();
  if (existing) {
    return res.status(409).json({ error: 'Этот юзернейм уже выставлен на продажу' });
  }

  const user = db.get('users').find({ telegram_id: id }).value();
  if (!user) return res.status(401).json({ error: 'Сначала зарегистрируйтесь' });

  const newListing = {
    id: db.getNextListingId(),
    seller_id: id,
    username: username.toLowerCase(),
    description: description || null,
    price: priceNum,
    status: 'active',
    created_at: new Date().toISOString(),
  };

  db.get('listings').push(newListing).write();
  res.json({ success: true, listing: newListing });
});

// Удалить своё объявление
router.delete('/:id', validateTelegramData, (req, res) => {
  const { id } = req.telegramUser;
  const listingId = parseInt(req.params.id);

  const listing = db.get('listings').find({ id: listingId }).value();
  if (!listing) return res.status(404).json({ error: 'Объявление не найдено' });
  if (listing.seller_id !== id) return res.status(403).json({ error: 'Нет доступа' });
  if (listing.status !== 'active') return res.status(400).json({ error: 'Нельзя удалить это объявление' });

  db.get('listings').find({ id: listingId }).assign({ status: 'cancelled' }).write();
  res.json({ success: true });
});

module.exports = router;
