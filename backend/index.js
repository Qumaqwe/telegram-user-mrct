require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./database');
const { createBot } = require('./bot');
const botInstance = require('./botInstance');
const { generalLimiter } = require('./middleware/rateLimit');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3001;
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:5173';

app.use(cors());
app.use('/api', generalLimiter);

// Webhook needs the raw body for HMAC verification; everything else uses JSON.
// Single conditional middleware avoids mounting the orders router twice.
app.use((req, res, next) => {
  if (req.path === '/api/orders/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

app.use('/api/users',    require('./routes/users'));
app.use('/api/services', require('./routes/services'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin',    require('./routes/admin'));

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));

    if (process.env.BOT_TOKEN) {
      const bot = createBot(WEBAPP_URL);
      botInstance.set(bot);

      const launchBot = async (retriesLeft = 5) => {
        try {
          await bot.launch({ dropPendingUpdates: true });
          console.log('🤖 Бот запущен!');
        } catch (err) {
          if (err.response?.error_code === 409 && retriesLeft > 0) {
            const delay = (6 - retriesLeft) * 3000; // 3s, 6s, 9s, 12s, 15s
            console.warn(`⚠️  Конфликт бота (409), повтор через ${delay / 1000}с... (осталось ${retriesLeft})`);
            setTimeout(() => launchBot(retriesLeft - 1), delay);
          } else {
            console.error('❌ Бот не запустился:', err.message);
          }
        }
      };

      launchBot();
      startScheduler(bot);
      process.once('SIGINT',  () => bot.stop('SIGINT'));
      process.once('SIGTERM', () => bot.stop('SIGTERM'));
    } else {
      console.warn('⚠️  BOT_TOKEN не указан');
    }
  })
  .catch((err) => {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    process.exit(1);
  });
