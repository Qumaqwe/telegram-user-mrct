const { Telegraf, Markup } = require('telegraf');
const db = require('./database');

function createBot(webappUrl) {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  async function sendInvoiceForListing(ctx, listingId) {
    const buyerId = ctx.from.id;

    const listing = db.get('listings').find({ id: listingId, status: 'active' }).value();
    if (!listing) {
      await ctx.reply('❌ Это объявление уже не активно');
      return;
    }
    if (listing.seller_id === buyerId) {
      await ctx.reply('❌ Нельзя купить у самого себя');
      return;
    }

    const txId = db.getNextTransactionId();
    db.get('transactions')
      .push({
        id: txId,
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: listing.seller_id,
        amount: listing.price,
        status: 'pending',
        stars_payment_id: null,
        created_at: new Date().toISOString(),
      })
      .write();

    await ctx.replyWithInvoice({
      title: `@${listing.username}`,
      description: listing.description || `Покупка юзернейма @${listing.username}`,
      payload: JSON.stringify({ transaction_id: txId, listing_id: listingId }),
      currency: 'XTR',
      prices: [{ label: `@${listing.username}`, amount: listing.price }],
      provider_token: '',
    });
  }

  // /start — главная команда
  bot.start(async (ctx) => {
    const user = ctx.from;

    // Регистрируем пользователя
    const existing = db.get('users').find({ telegram_id: user.id }).value();
    if (existing) {
      db.get('users').find({ telegram_id: user.id }).assign({
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
      }).write();
    } else {
      db.get('users').push({
        telegram_id: user.id,
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        created_at: new Date().toISOString(),
      }).write();
    }

    // Если /start пришёл с payload (deep-link), например: ?start=buy_12
    const payload = ctx.startPayload;
    if (payload && /^buy_\d+$/.test(payload)) {
      const listingId = parseInt(payload.split('_')[1]);
      await sendInvoiceForListing(ctx, listingId);
      return;
    }

    await ctx.reply(
      `👋 Привет, ${user.first_name}!\n\n` +
        `🏪 Добро пожаловать в <b>Username Market</b> — маркетплейс Telegram-юзернеймов!\n\n` +
        `Здесь ты можешь:\n` +
        `• 🛒 Купить красивый юзернейм\n` +
        `• 💰 Продать свой юзернейм за Telegram Stars\n\n` +
        `Нажми кнопку ниже, чтобы открыть магазин:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([[Markup.button.webApp('🏪 Открыть маркет', webappUrl)]]).resize(),
      }
    );
  });

  // /help
  bot.command('help', (ctx) => {
    ctx.reply(
      `📖 <b>Как пользоваться Username Market</b>\n\n` +
      `<b>Покупка:</b>\n` +
      `1. Открой маркет кнопкой ниже\n` +
      `2. Найди нужный юзернейм\n` +
      `3. Нажми "Купить" — откроется бот для оплаты\n` +
      `4. Продавец свяжется с тобой для передачи\n\n` +
      `<b>Продажа:</b>\n` +
      `1. Открой маркет → вкладка "Продать"\n` +
      `2. Заполни форму и опубликуй объявление\n` +
      `3. Когда найдётся покупатель — получи Stars\n\n` +
      `⚠️ После оплаты юзернейм передаётся вручную.`,
      { parse_mode: 'HTML' }
    );
  });

  // Обработчик pre-checkout для Stars
  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // Обработчик успешного платежа Stars
  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const buyerId = ctx.from.id;

    try {
      const payload = JSON.parse(payment.invoice_payload);
      const tx = db.get('transactions').find({ id: payload.transaction_id }).value();

      if (tx && tx.buyer_id === buyerId) {
        db.get('transactions').find({ id: tx.id })
          .assign({ status: 'completed', stars_payment_id: payment.telegram_payment_charge_id })
          .write();

        db.get('listings').find({ id: tx.listing_id })
          .assign({ status: 'sold' })
          .write();

        const listing = db.get('listings').find({ id: tx.listing_id }).value();
        const seller = db.get('users').find({ telegram_id: tx.seller_id }).value();

        await ctx.reply(
          `✅ <b>Оплата прошла!</b>\n\n` +
          `Ты купил юзернейм: <code>@${listing.username}</code>\n` +
          `Сумма: ${payment.total_amount} ⭐\n\n` +
          `${seller?.username ? `Написать продавцу: @${seller.username}` : 'Продавец напишет тебе сам'}`,
          { parse_mode: 'HTML' }
        );

        // Уведомляем продавца
        await bot.telegram.sendMessage(
          tx.seller_id,
          `💰 <b>Твой юзернейм продан!</b>\n\n` +
          `Юзернейм: <code>@${listing.username}</code>\n` +
          `Сумма: ${payment.total_amount} ⭐\n\n` +
          `Покупатель: ${ctx.from.first_name}${ctx.from.username ? ` (@${ctx.from.username})` : ''}\n\n` +
          `⚠️ Пожалуйста, свяжись с покупателем и передай юзернейм!`,
          { parse_mode: 'HTML' }
        );
      }
    } catch (err) {
      console.error('Payment processing error:', err);
    }
  });

  // Inline-кнопка для покупки (через deep link)
  bot.action(/^buy_(\d+)$/, async (ctx) => {
    const listingId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await sendInvoiceForListing(ctx, listingId);
  });

  return bot;
}

module.exports = { createBot };
