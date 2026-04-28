const crypto = require('crypto');
const { db } = require('../database');

// Проверяем, что данные пришли именно из Telegram (защита от мошенников)
async function validateTelegramData(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  // Если initData нет совсем — отказываем
  if (!initData) {
    return res.status(401).json({ error: 'Нет данных авторизации' });
  }

  // Режим разработки: принимаем только специальный тестовый токен.
  // Требует явного ALLOW_DEV_MODE=true в .env — NODE_ENV недостаточно,
  // чтобы случайный деплой без NODE_ENV не открыл bypass.
  if (process.env.ALLOW_DEV_MODE === 'true' && initData === 'dev_mode') {
    console.warn('⚠️  AUTH: dev_mode bypass использован (ALLOW_DEV_MODE=true)');
    req.telegramUser = { id: 123456789, username: 'testuser', first_name: 'Test', last_name: 'User' };
    return next();
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');

    if (!hash) {
      return res.status(401).json({ error: 'Отсутствует подпись' });
    }

    urlParams.delete('hash');

    // Сортируем и собираем строку для проверки (стандарт Telegram)
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
      return res.status(401).json({ error: 'Подпись недействительна' });
    }

    // Данные не должны быть старше 24 часов
    const authDate = parseInt(urlParams.get('auth_date'));
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      return res.status(401).json({ error: 'Сессия устарела, перезапусти приложение' });
    }

    const user = JSON.parse(urlParams.get('user'));

    // Базовая проверка — у пользователя должен быть ID
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Неверные данные пользователя' });
    }

    // Проверка бана
    const dbUser = await db.findOne('users', { telegram_id: user.id });
    if (dbUser?.is_banned) {
      return res.status(403).json({
        error: 'Ваш аккаунт заблокирован' + (dbUser.ban_reason ? `. Причина: ${dbUser.ban_reason}` : ''),
        banned: true,
      });
    }

    req.telegramUser = user;
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(401).json({ error: 'Ошибка авторизации' });
  }
}

// Проверка что запрос от администратора
function requireAdmin(req, res, next) {
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map((id) => parseInt(id.trim()));
  if (!adminIds.includes(req.telegramUser?.id)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  next();
}

module.exports = { validateTelegramData, requireAdmin };
