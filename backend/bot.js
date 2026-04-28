const { Telegraf, Markup } = require('telegraf');
const { db } = require('./database');

function createBot(webappUrl) {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  function isAdmin(userId) {
    return (process.env.ADMIN_IDS || '').split(',').map((id) => parseInt(id.trim())).includes(userId);
  }

  async function upsertUser(from) {
    await db.query(
      `INSERT INTO users (telegram_id, username, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE
         SET username = $2, first_name = $3, last_name = $4`,
      [from.id, from.username || null, from.first_name || null, from.last_name || null]
    );
  }

  // /start
  bot.start(async (ctx) => {
    await upsertUser(ctx.from);
    await ctx.reply(
      `👋 Привет, <b>${ctx.from.first_name}</b>!\n\n` +
      `Добро пожаловать в <b>CoreTalent</b> — биржа фриланс-услуг с гарантией оплаты в TON/USDT.\n\n` +
      `• 🛒 Найди исполнителя для своего проекта\n` +
      `• 💼 Предложи свои услуги и зарабатывай\n` +
      `• 🔒 Безопасная оплата через эскроу\n\n` +
      `<b>Важно:</b>\n` +
      `• Никогда не запрашиваем доступ к личным данным вне платформы\n` +
      `• Все выплаты происходят только после подтверждения сделки\n\n` +
      `⚠️ Для получения выплат запусти @CryptoBot`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.webApp('🏪 Открыть маркет', webappUrl)]]),
      }
    );
  });

  // /help
  bot.command('help', (ctx) => {
    ctx.reply(
      `📖 <b>Как работает CoreTalent</b>\n\n` +
      `<b>Заказчик:</b>\n` +
      `1. Открой маркет, найди нужную услугу\n` +
      `2. Нажми "Заказать" — оплати через @CryptoBot\n` +
      `3. Деньги в эскроу — исполнитель работает\n` +
      `4. Подтверди выполнение — деньги переведутся автоматически\n\n` +
      `<b>Исполнитель:</b>\n` +
      `1. Создай услугу с описанием и ценой\n` +
      `2. Получи уведомление о новом заказе\n` +
      `3. Выполни работу → нажми "Выполнено"\n` +
      `4. После подтверждения — деньги на твоём @CryptoBot\n\n` +
      `<b>Комиссия платформы:</b> 5%\n` +
      `<b>Валюты:</b> TON, USDT`,
      { parse_mode: 'HTML' }
    );
  });

  // /admin
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');

    const [users, services, orders] = await Promise.all([
      db.findMany('users',    {}),
      db.findMany('services', {}),
      db.findMany('orders',   {}),
    ]);
    const completed = orders.filter((o) => o.status === 'completed');
    const volume    = completed.reduce((s, o) => s + o.amount, 0);
    const disputed  = orders.filter((o) => o.status === 'disputed').length;

    await ctx.reply(
      `👑 <b>Панель администратора</b>\n\n` +
      `👥 Пользователей: <b>${users.length}</b>\n` +
      `💼 Активных услуг: <b>${services.filter((s) => s.status === 'active').length}</b>\n` +
      `📦 Заказов всего: <b>${orders.length}</b>\n` +
      `✅ Завершено: <b>${completed.length}</b>\n` +
      `🚨 Споров: <b>${disputed}</b>\n` +
      `💰 Оборот: <b>${volume.toFixed(2)} TON/USDT</b>`,
      { parse_mode: 'HTML' }
    );
  });

  // Admin: /cancel <order_id> — force-close order without transfer
  bot.command('cancel', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');
    const parts = ctx.message.text.trim().split(/\s+/);
    const orderId = parseInt(parts[1]);
    if (!orderId) return ctx.reply('Использование: /cancel <id_заказа>');

    const order = await db.findOne('orders', { id: orderId });
    if (!order) return ctx.reply(`Заказ #${orderId} не найден`);

    await db.updateOne('orders', {
      status:      'refunded',
      refunded_at: new Date().toISOString(),
    }, { id: orderId });

    await ctx.reply(
      `✅ Заказ #${orderId} принудительно закрыт (refunded).\n\n` +
      `Услуга: ${order.service_title}\n` +
      `Сумма: ${order.amount} ${order.currency}\n` +
      `Покупатель ID: ${order.buyer_id}\n` +
      `Продавец ID: ${order.seller_id}`
    );

    // Notify buyer
    try {
      await ctx.telegram.sendMessage(
        order.buyer_id,
        `ℹ️ Заказ #${orderId} (<b>${order.service_title}</b>) был закрыт администратором.\n` +
        `По вопросам возврата средств обращайтесь к администратору.`,
        { parse_mode: 'HTML' }
      );
    } catch {}
  });

  // Admin: /orders — list recent orders with status
  bot.command('orders', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');
    const orders = await db.findMany('orders', {}, 'created_at DESC');
    const recent = orders.slice(0, 10);
    if (!recent.length) return ctx.reply('Заказов нет');

    const STATUS = {
      pending_payment: '⏳',
      in_progress: '🔨',
      delivered: '📦',
      completed: '✅',
      disputed: '⚠️',
      refunded: '↩️',
    };

    const text = recent.map((o) =>
      `${STATUS[o.status] || '?'} #${o.id} — ${o.service_title}\n` +
      `   ${o.amount} ${o.currency} · ${o.status}`
    ).join('\n\n');

    await ctx.reply(`📋 <b>Последние 10 заказов:</b>\n\n${text}\n\nДля отмены: /cancel &lt;id&gt;`, { parse_mode: 'HTML' });
  });

  // Seller marks order as delivered
  bot.action(/^deliver_(\d+)$/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const order = await db.findOne('orders', { id: orderId });

    if (!order) return ctx.answerCbQuery('Заказ не найден');
    if (order.seller_id !== ctx.from.id) return ctx.answerCbQuery('Нет доступа');
    if (order.status !== 'in_progress') return ctx.answerCbQuery('Нельзя обновить статус');

    await db.updateOne('orders', {
      status:       'delivered',
      delivered_at: new Date().toISOString(),
    }, { id: orderId });

    await ctx.answerCbQuery('✅ Покупатель уведомлён!');
    await ctx.editMessageText(
      `✅ <b>Заказ #${orderId} отправлен на проверку</b>\n\nОжидаем подтверждения от покупателя...`,
      { parse_mode: 'HTML' }
    );

    await ctx.telegram.sendMessage(
      order.buyer_id,
      `📦 <b>Заказ #${orderId} выполнен!</b>\n\n` +
      `Услуга: <b>${order.service_title}</b>\n\n` +
      `Исполнитель отметил заказ как выполненный. Проверь результат и подтверди получение:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Принять и оплатить', callback_data: `confirm_${orderId}` },
            { text: '❌ Открыть спор',       callback_data: `dispute_${orderId}` },
          ]],
        },
      }
    );
  });

  // Buyer confirms delivery → trigger transfer
  bot.action(/^confirm_(\d+)$/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const order = await db.findOne('orders', { id: orderId });

    if (!order) return ctx.answerCbQuery('Заказ не найден');
    if (order.buyer_id !== ctx.from.id) return ctx.answerCbQuery('Нет доступа');
    if (!['in_progress', 'delivered'].includes(order.status)) return ctx.answerCbQuery('Уже обработано');

    const cryptobot = require('./cryptobot');
    try {
      await cryptobot.transfer({
        userId:  order.seller_id,
        asset:   order.currency,
        amount:  order.seller_amount,
        spendId: `order_${orderId}`,
        comment: `Оплата за заказ #${orderId}: ${order.service_title}`,
      });
    } catch (err) {
      console.error('Transfer error:', err.message);
      await ctx.answerCbQuery('Ошибка перевода');
      return ctx.reply(`❌ Ошибка перевода:\n<code>${err.message}</code>\n\nОбратитесь к администратору.`, { parse_mode: 'HTML' });
    }

    await db.updateOne('orders', {
      status:       'completed',
      completed_at: new Date().toISOString(),
    }, { id: orderId });

    await ctx.answerCbQuery('🎉 Оплата переведена!');
    await ctx.editMessageText(
      `🎉 <b>Заказ #${orderId} завершён!</b>\n\n` +
      `<b>${order.seller_amount} ${order.currency}</b> переведены исполнителю через @CryptoBot.\n\nСпасибо за использование CoreTalent!`,
      { parse_mode: 'HTML' }
    );

    await ctx.telegram.sendMessage(
      order.seller_id,
      `🎉 <b>Оплата получена!</b>\n\n` +
      `Заказ #${orderId}: <b>${order.service_title}</b>\n` +
      `Сумма: <b>${order.seller_amount} ${order.currency}</b>\n\n` +
      `Деньги переведены на ваш @CryptoBot кошелёк!`,
      { parse_mode: 'HTML' }
    );
  });

  // Buyer opens dispute
  bot.action(/^dispute_(\d+)$/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const order = await db.findOne('orders', { id: orderId });

    if (!order) return ctx.answerCbQuery('Заказ не найден');
    if (order.buyer_id !== ctx.from.id) return ctx.answerCbQuery('Нет доступа');

    await db.updateOne('orders', {
      status:      'disputed',
      disputed_at: new Date().toISOString(),
    }, { id: orderId });

    await ctx.answerCbQuery('Спор открыт');
    await ctx.editMessageText(
      `⚠️ <b>Спор открыт по заказу #${orderId}</b>\n\nАдминистратор разберётся и свяжется с вами.`,
      { parse_mode: 'HTML' }
    );

    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
    for (const adminId of adminIds) {
      await ctx.telegram.sendMessage(
        adminId,
        `🚨 <b>Спор! Заказ #${orderId}</b>\n\n` +
        `Услуга: ${order.service_title}\n` +
        `Покупатель: ${order.buyer_id}\n` +
        `Продавец: ${order.seller_id}\n` +
        `Сумма: ${order.amount} ${order.currency}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  return bot;
}

module.exports = { createBot };
