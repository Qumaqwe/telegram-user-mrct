require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createBot } = require('./bot');
const botInstance = require('./botInstance');

const app = express();
const PORT = process.env.PORT || 3001;
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5173';

app.use(cors());

// Webhook route needs raw body — must be registered before express.json()
app.use('/api/orders/webhook', require('./routes/orders'));
app.use(express.json());

app.use('/api/users',    require('./routes/users'));
app.use('/api/services', require('./routes/services'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/admin',    require('./routes/admin'));

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));

if (process.env.BOT_TOKEN) {
  const bot = createBot(WEBAPP_URL);
  botInstance.set(bot);
  bot.launch().then(() => console.log('🤖 Бот запущен!'));
  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn('⚠️  BOT_TOKEN не указан');
}
