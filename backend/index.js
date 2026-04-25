require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3001;
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5173';

app.use(cors());
app.use(express.json());

// Маршруты API
app.use('/api/users', require('./routes/users'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/payments', require('./routes/payments'));

// Проверка, что сервер работает
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Запускаем сервер
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 API доступен: http://localhost:${PORT}/api`);
});

// Запускаем бота
if (process.env.BOT_TOKEN) {
  const bot = createBot(WEBAPP_URL);
  bot.launch().then(() => {
    console.log('🤖 Бот запущен!');
  }).catch((err) => {
    console.error('❌ Ошибка запуска бота:', err.message);
  });

  // Корректное завершение при остановке
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn('⚠️  BOT_TOKEN не указан — бот не запущен');
}
