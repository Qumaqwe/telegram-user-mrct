const crypto = require('crypto');

// Проверяем, что данные пришли именно из Telegram (защита от мошенников)
function validateTelegramData(req, res, next) {
  // В режиме разработки - пропускаем проверку
  if (process.env.NODE_ENV === 'development') {
    // Используем тестового пользователя
    req.telegramUser = {
      id: 123456789,
      username: 'testuser',
      first_name: 'Test',
      last_name: 'User'
    };
    return next();
  }

  const initData = req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(401).json({ error: 'Нет данных авторизации' });
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    // Сортируем и собираем строку для проверки
    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Создаём секретный ключ из токена бота
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return res.status(401).json({ error: 'Данные авторизации недействительны' });
    }

    // Проверяем, не устарели ли данные (1 час)
    const authDate = parseInt(urlParams.get('auth_date'));
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 3600) {
      return res.status(401).json({ error: 'Данные авторизации устарели' });
    }

    const user = JSON.parse(urlParams.get('user'));
    req.telegramUser = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Ошибка авторизации' });
  }
}

module.exports = { validateTelegramData };
