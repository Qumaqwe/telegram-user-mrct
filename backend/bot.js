const { Telegraf, Markup } = require('telegraf');
const db = require('./database');

function createBot(webappUrl) {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // ─── Вспомогательные функции ─────────────────────────────────────────────────

  function isAdmin(userId) {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map((id) => parseInt(id.trim()));
    return adminIds.includes(userId);
  }

  function upsertUser(from) {
    const existing = db.get('users').find({ telegram_id: from.id }).value();
    if (existing) {
      db.get('users').find({ telegram_id: from.id }).assign({
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
      }).write();
    } else {
      db.get('users').push({
        telegram_id: from.id,
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        created_at: new Date().toISOString(),
      }).write();
    }
  }

  async function sendInvoiceForListing(ctx, listingId) {
    const buyerId = ctx.from.id;
    const listing = db.get('listings').find({ id: parseInt(listingId), status: 'active' }).value();

    if (!listing) { await ctx.reply('❌ Это объявление уже не активно'); return; }
    if (listing.seller_id === buyerId) { await ctx.reply('❌ Нельзя купить у самого себя'); return; }

    const txId = db.getNextTransactionId();
    db.get('transactions').push({
      id: txId, listing_id: listing.id,
      buyer_id: buyerId, seller_id: listing.seller_id,
      amount: listing.price, status: 'pending',
      stars_payment_id: null, created_at: new Date().toISOString(),
    }).write();

    await ctx.replyWithInvoice({
      title: `@${listing.username}`,
      description: listing.description || `Покупка юзернейма @${listing.username}`,
      payload: JSON.stringify({ transaction_id: txId, listing_id: listing.id }),
      currency: 'XTR',
      prices: [{ label: `@${listing.username}`, amount: listing.price }],
      provider_token: '',
    });
  }

  // ─── /start ───────────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    upsertUser(ctx.from);

    const payload = ctx.startPayload;
    if (payload && /^buy_\d+$/.test(payload)) {
      await sendInvoiceForListing(ctx, payload.slice(4));
      return;
    }

    await ctx.reply(
      `👋 Привет, ${ctx.from.first_name}!\n\n` +
      `🏪 Добро пожаловать в <b>RareID</b> — платформа для обмена Telegram-никнеймами!\n\n` +
      `Здесь ты можешь:\n` +
      `• 🛒 Купить красивый юзернейм\n` +
      `• 💰 Продать свой юзернейм за Telegram Stars`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.webApp('🏪 Главное меню', webappUrl)]]),
      }
    );
  });

  // ─── /help ────────────────────────────────────────────────────────────────────
  bot.command('help', (ctx) => {
    ctx.reply(
      `📖 <b>Как пользоваться RareID</b>\n\n` +
      `<b>Покупка:</b>\n` +
      `1. Открой маркет кнопкой ниже\n` +
      `2. Найди нужный юзернейм\n` +
      `3. Нажми "Купить" — откроется бот для оплаты\n\n` +
      `<b>Продажа:</b>\n` +
      `1. Открой маркет → вкладка "Продать"\n` +
      `2. Заполни форму и опубликуй объявление\n` +
      `3. Когда найдётся покупатель — получи Stars\n\n` +
      `⚠️ После оплаты юзернейм передаётся через бота.`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── Команды администратора ──────────────────────────────────────────────────
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');

    const users        = db.get('users').value();
    const listings     = db.get('listings').value();
    const transactions = db.get('transactions').value();
    const completed    = transactions.filter((t) => t.status === 'completed');
    const volume       = completed.reduce((s, t) => s + t.amount, 0);

    await ctx.reply(
      `👑 <b>Панель администратора</b>\n\n` +
      `👥 Пользователей: <b>${users.length}</b>\n` +
      `📋 Активных объявлений: <b>${listings.filter((l) => l.status === 'active').length}</b>\n` +
      `✅ Продано: <b>${listings.filter((l) => l.status === 'sold').length}</b>\n` +
      `💳 Сделок завершено: <b>${completed.length}</b>\n` +
      `💰 Оборот: <b>${volume.toLocaleString()} ⭐</b>\n\n` +
      `/stats /recent /delisting [id]`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const transactions = db.get('transactions').value();
    const completed    = transactions.filter((t) => t.status === 'completed');
    const volume       = completed.reduce((s, t) => s + t.amount, 0);
    await ctx.reply(
      `📊 <b>Статистика</b>\n\n` +
      `⏳ Ожидают оплаты: <b>${transactions.filter((t) => t.status === 'pending').length}</b>\n` +
      `✅ Завершены: <b>${completed.length}</b>\n` +
      `💰 Оборот: <b>${volume.toLocaleString()} ⭐</b>`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('recent', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const recent = db.get('transactions').value()
      .filter((t) => t.status === 'completed')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);
    if (!recent.length) return ctx.reply('Нет завершённых сделок');
    const lines = recent.map((t) => {
      const listing = db.get('listings').find({ id: t.listing_id }).value();
      return `• @${listing?.username || '?'} — ${t.amount} ⭐`;
    });
    await ctx.reply(`🕓 <b>Последние сделки:</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.command('delisting', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const id = parseInt(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply('Использование: /delisting [id объявления]');
    const listing = db.get('listings').find({ id }).value();
    if (!listing) return ctx.reply(`❌ Объявление не найдено`);
    db.get('listings').find({ id }).assign({ status: 'cancelled' }).write();
    await ctx.reply(`✅ @${listing.username} снят с продажи`);
  });

  // ─── Платежи Stars ────────────────────────────────────────────────────────────
  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const buyerId = ctx.from.id;

    try {
      const payload = JSON.parse(payment.invoice_payload);
      const tx = db.get('transactions').find({ id: payload.transaction_id }).value();
      if (!tx || tx.buyer_id !== buyerId) return;

      db.get('transactions').find({ id: tx.id }).assign({
        status: 'completed', stars_payment_id: payment.telegram_payment_charge_id,
      }).write();
      db.get('listings').find({ id: tx.listing_id }).assign({ status: 'sold' }).write();

      const listing = db.get('listings').find({ id: tx.listing_id }).value();

      // Покупатель
      await ctx.reply(
        `✅ <b>Оплата прошла! ${payment.total_amount} ⭐ списаны.</b>\n\n` +
        `Юзернейм: <code>@${listing.username}</code>\n\n` +
        `⏳ Как только продавец освободит юзернейм — бот пришлёт тебе сигнал.\nДержи телефон наготове 📱`,
        { parse_mode: 'HTML' }
      );

      // Продавец
      await bot.telegram.sendMessage(
        tx.seller_id,
        `💰 <b>Твой юзернейм куплен!</b>\n\n` +
        `Юзернейм: <code>@${listing.username}</code>\n` +
        `Сумма: <b>${payment.total_amount} ⭐</b>\n\n` +
        `<b>Как передать покупателю:</b>\n` +
        `1. Настройки → Редактировать профиль\n` +
        `2. Удали <code>${listing.username}</code> и сохрани\n` +
        `3. Нажми кнопку ниже ⬇️`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{
              text: '✅ Я освободил юзернейм — оповестить покупателя!',
              callback_data: `released_${tx.id}_${buyerId}`,
            }]],
          },
        }
      );
    } catch (err) {
      console.error('Payment error:', err);
    }
  });

  // Продавец освободил юзернейм → мгновенно оповещаем покупателя
  bot.action(/^released_(\d+)_(\d+)$/, async (ctx) => {
    const txId    = parseInt(ctx.match[1]);
    const buyerId = parseInt(ctx.match[2]);

    await ctx.answerCbQuery('Покупатель оповещён! ✅');

    const tx      = db.get('transactions').find({ id: txId }).value();
    const listing = db.get('listings').find({ id: tx.listing_id }).value();

    await ctx.editMessageText(
      `✅ <b>Покупатель оповещён!</b>\n\nЮзернейм <code>@${listing.username}</code> освобождён.\nОжидаем подтверждения...`,
      { parse_mode: 'HTML' }
    );

    await bot.telegram.sendMessage(
      buyerId,
      `🚨 <b>СЕЙЧАС! Хватай юзернейм!</b>\n\n` +
      `Продавец только что освободил <code>@${listing.username}</code>\n\n` +
      `👉 Немедленно:\nНастройки → Редактировать профиль → Имя пользователя → <code>${listing.username}</code> → Сохранить\n\n` +
      `У тебя есть несколько секунд ⚡`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Получил!',  callback_data: `confirmed_${txId}_${tx.seller_id}` },
            { text: '❌ Не успел', callback_data: `failed_${txId}_${tx.seller_id}` },
          ]],
        },
      }
    );
  });

  // Покупатель подтвердил
  bot.action(/^confirmed_(\d+)_(\d+)$/, async (ctx) => {
    const txId     = parseInt(ctx.match[1]);
    const sellerId = parseInt(ctx.match[2]);

    await ctx.answerCbQuery('🎉 Поздравляем!');
    const listing = db.get('listings').find({
      id: db.get('transactions').find({ id: txId }).value()?.listing_id,
    }).value();

    await ctx.editMessageText(
      `🎉 <b>Сделка завершена!</b>\n\nЮзернейм <code>@${listing?.username}</code> твой!\nСпасибо за покупку 🏪`,
      { parse_mode: 'HTML' }
    );
    await bot.telegram.sendMessage(
      sellerId,
      `🎉 <b>Сделка завершена!</b>\n\nПокупатель подтвердил получение <code>@${listing?.username}</code>. Спасибо! 💰`,
      { parse_mode: 'HTML' }
    );
  });

  // Покупатель не успел
  bot.action(/^failed_(\d+)_(\d+)$/, async (ctx) => {
    const txId     = parseInt(ctx.match[1]);
    const sellerId = parseInt(ctx.match[2]);

    await ctx.answerCbQuery('Разберёмся');

    const tx      = db.get('transactions').find({ id: txId }).value();
    const listing = db.get('listings').find({ id: tx?.listing_id }).value();
    db.get('transactions').find({ id: txId }).assign({ status: 'disputed' }).write();

    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);

    await ctx.editMessageText(
      `😔 <b>Не успел.</b>\n\nАдминистратор уже уведомлён и разберётся с ситуацией. Ожидай сообщения.`,
      { parse_mode: 'HTML' }
    );
    await bot.telegram.sendMessage(
      sellerId,
      `⚠️ Покупатель не успел получить @${listing?.username}. Свяжитесь с администратором.`,
      { parse_mode: 'HTML' }
    );
    for (const adminId of adminIds) {
      await bot.telegram.sendMessage(
        adminId,
        `🚨 <b>Спор!</b> @${listing?.username}\nТранзакция ID: ${txId}\nПокупатель: ${ctx.from.id} | Продавец: ${sellerId}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Inline-кнопка покупки
  bot.action(/^buy_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await sendInvoiceForListing(ctx, ctx.match[1]);
  });

  return bot;
}

module.exports = { createBot };
