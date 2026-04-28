const { Telegraf, Markup } = require('telegraf');
const { db } = require('./database');
const { escapeHtml, logger, notifyViaBot } = require('./utils');
const { completeOrder } = require('./escrow');
const cryptobot = require('./cryptobot');

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
      `👋 Привет, <b>${escapeHtml(ctx.from.first_name)}</b>!\n\n` +
      `Добро пожаловать в <b>CoreTalent</b> — биржа фриланс-услуг с гарантией оплаты в TON/USDT.\n\n` +
      `• 🛒 Найди исполнителя для своего проекта\n` +
      `• 💼 Предложи свои услуги и зарабатывай\n` +
      `• 🔒 Безопасная оплата через эскроу\n\n` +
      `<b>Важно:</b>\n` +
      `• Никогда не запрашиваем доступ к личным данным вне платформы\n` +
      `• Все выплаты происходят только после подтверждения сделки\n\n` +
      `💵 Для получения выплат запусти @CryptoBot`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp('🏪 Открыть маркет', webappUrl)],
          [Markup.button.callback('📖 Как это работает', 'show_help')],
        ]),
      }
    );
  });

  const HELP_TEXT =
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
    `<b>Валюты:</b> TON, USDT\n\n` +
    `📋 Правила платформы: /rules\n` +
    `❓ Проблема или нарушение? Напиши /report`;

  // Кнопка «📖 Как это работает» из стартового сообщения
  bot.action('show_help', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
  });

  // /help
  bot.command('help', (ctx) => {
    ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
  });

  // /rules — правила платформы
  bot.command('rules', (ctx) => {
    ctx.reply(
      `📋 <b>Правила CoreTalent</b>\n\n` +
      `<b>🚫 Запрещено:</b>\n` +
      `• Принимать или требовать оплату вне платформы\n` +
      `• Создавать фиктивные или вводящие в заблуждение услуги\n` +
      `• Угрозы, оскорбления и давление на участников сделки\n` +
      `• Регистрировать несколько аккаунтов\n` +
      `• Накручивать отзывы и оценки\n\n` +
      `<b>✅ Обязательно:</b>\n` +
      `• Выполнять заказ в указанный срок\n` +
      `• Описывать услугу честно и точно\n` +
      `• Решать все споры только через платформу\n` +
      `• Запускать @CryptoBot для получения выплат\n\n` +
      `<b>⚖️ Последствия нарушений:</b>\n` +
      `• Предупреждение → заморозка аккаунта → постоянный бан\n` +
      `• Незавершённые сделки возвращаются покупателю\n\n` +
      `Заметил нарушение? /report`,
      { parse_mode: 'HTML' }
    );
  });

  // /report <текст> — отправить жалобу администратору
  bot.command('report', async (ctx) => {
    const text = ctx.message.text.replace(/^\/report\s*/i, '').trim();

    if (!text) {
      return ctx.reply(
        `📝 <b>Как отправить жалобу:</b>\n\n` +
        `/report <i>опишите проблему</i>\n\n` +
        `Например:\n` +
        `/report Продавец @username требует оплату вне платформы`,
        { parse_mode: 'HTML' }
      );
    }

    const from = ctx.from;
    const userLink = from.username
      ? `@${escapeHtml(from.username)}`
      : `<a href="tg://user?id=${from.id}">${escapeHtml(from.first_name || 'Пользователь')}</a>`;

    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
    let sent = 0;
    for (const adminId of adminIds) {
      try {
        await ctx.telegram.sendMessage(
          adminId,
          `🚨 <b>Жалоба от пользователя</b>\n\n` +
          `От: ${userLink} (ID: ${from.id})\n\n` +
          `<b>Текст жалобы:</b>\n${escapeHtml(text)}`,
          { parse_mode: 'HTML' }
        );
        sent++;
      } catch {}
    }

    if (sent > 0) {
      await ctx.reply(
        `✅ Жалоба отправлена администратору.\n\nМы рассмотрим её в ближайшее время.`
      );
    } else {
      await ctx.reply(`⚠️ Не удалось отправить жалобу. Попробуйте позже.`);
    }
  });

  // /user <user_id> — информация о пользователе
  bot.command('user', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');

    const parts = ctx.message.text.trim().split(/\s+/);
    const userId = parseInt(parts[1]);
    if (!userId) return ctx.reply('Использование: /user <user_id>');

    const [user, servicesCount, ordersAsBuyer, ordersAsSeller] = await Promise.all([
      db.findOne('users', { telegram_id: userId }),
      db.count('services', { seller_id: userId, status: 'active' }),
      db.count('orders',   { buyer_id:  userId }),
      db.count('orders',   { seller_id: userId }),
    ]);

    if (!user) return ctx.reply(`❌ Пользователь ${userId} не найден в базе`);

    const name     = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const username = user.username ? `@${escapeHtml(user.username)}` : 'не указан';
    const banLine  = user.is_banned
      ? `🚫 <b>Заблокирован</b>${user.ban_reason ? `: ${escapeHtml(user.ban_reason)}` : ''}`
      : `✅ Активен`;

    await ctx.reply(
      `👤 <b>Пользователь #${userId}</b>\n\n` +
      `Имя: ${escapeHtml(name) || 'не указано'}\n` +
      `Username: ${username}\n` +
      `Зарегистрирован: ${new Date(user.created_at).toLocaleDateString('ru-RU')}\n\n` +
      `💼 Активных услуг: <b>${servicesCount}</b>\n` +
      `🛒 Заказов (покупатель): <b>${ordersAsBuyer}</b>\n` +
      `📦 Заказов (продавец): <b>${ordersAsSeller}</b>\n\n` +
      `Статус: ${banLine}`,
      { parse_mode: 'HTML' }
    );
  });

  // /ban <user_id> [причина]
  bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');

    const parts = ctx.message.text.trim().split(/\s+/);
    const userId = parseInt(parts[1]);
    const reason = parts.slice(2).join(' ') || null;

    if (!userId) return ctx.reply('Использование: /ban <user_id> [причина]');

    const user = await db.findOne('users', { telegram_id: userId });
    if (!user) return ctx.reply(`❌ Пользователь ${userId} не найден`);
    if (user.is_banned) return ctx.reply(`⚠️ Пользователь ${userId} уже заблокирован`);

    // Блокируем пользователя и скрываем его активные услуги
    await db.updateOne('users', { is_banned: true, ban_reason: reason }, { telegram_id: userId });
    await db.query(
      `UPDATE services SET status = 'hidden' WHERE seller_id = $1 AND status = 'active'`,
      [userId]
    );

    // Уведомляем заблокированного
    try {
      await ctx.telegram.sendMessage(
        userId,
        `🚫 <b>Ваш аккаунт заблокирован</b>\n\n` +
        (reason ? `Причина: ${escapeHtml(reason)}\n\n` : '') +
        `Если считаете это ошибкой — напишите /report`,
        { parse_mode: 'HTML' }
      );
    } catch {}

    await ctx.reply(
      `✅ Пользователь ${userId} заблокирован.\n` +
      (reason ? `Причина: ${reason}\n` : '') +
      `Его активные услуги скрыты.`
    );
  });

  // /unban <user_id>
  bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');

    const parts = ctx.message.text.trim().split(/\s+/);
    const userId = parseInt(parts[1]);

    if (!userId) return ctx.reply('Использование: /unban <user_id>');

    const user = await db.findOne('users', { telegram_id: userId });
    if (!user) return ctx.reply(`❌ Пользователь ${userId} не найден`);
    if (!user.is_banned) return ctx.reply(`⚠️ Пользователь ${userId} не заблокирован`);

    // Снимаем блокировку и восстанавливаем услуги
    await db.updateOne('users', { is_banned: false, ban_reason: null }, { telegram_id: userId });
    await db.query(
      `UPDATE services SET status = 'active' WHERE seller_id = $1 AND status = 'hidden'`,
      [userId]
    );

    // Уведомляем разблокированного
    try {
      await ctx.telegram.sendMessage(
        userId,
        `✅ <b>Ваш аккаунт разблокирован</b>\n\nВы снова можете пользоваться платформой.`,
        { parse_mode: 'HTML' }
      );
    } catch {}

    await ctx.reply(`✅ Пользователь ${userId} разблокирован. Его услуги восстановлены.`);
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
      `💰 Оборот: <b>${volume.toFixed(2)} TON/USDT</b>\n\n` +
      `<b>━━━ Команды ━━━</b>\n` +
      `/orders — последние 10 заказов\n` +
      `/cancel &lt;id&gt; — закрыть заказ и вернуть деньги\n` +
      `/user &lt;id&gt; — информация о пользователе\n` +
      `/ban &lt;id&gt; [причина] — заблокировать\n` +
      `/unban &lt;id&gt; — разблокировать`,
      { parse_mode: 'HTML' }
    );
  });

  // Admin: /cancel <order_id>
  // — unpaid orders  (pending_payment): закрыть без перевода
  // — paid orders    (in_progress / delivered / disputed): вернуть деньги покупателю через CryptoBot
  bot.command('cancel', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('❌ Нет прав');
    const parts = ctx.message.text.trim().split(/\s+/);
    const orderId = parseInt(parts[1]);
    if (!orderId) return ctx.reply('Использование: /cancel <id_заказа>');

    const order = await db.findOne('orders', { id: orderId });
    if (!order) return ctx.reply(`Заказ #${orderId} не найден`);

    const TERMINAL = ['completed', 'refunded', 'cancelled'];
    if (TERMINAL.includes(order.status))
      return ctx.reply(`⚠️ Заказ #${orderId} уже в финальном статусе: ${order.status}`);

    const PAID_STATUSES = ['in_progress', 'delivered', 'disputed'];
    const wasPaid = PAID_STATUSES.includes(order.status);

    if (wasPaid) {
      // Perform actual on-chain refund — spend_id ensures idempotency
      try {
        await cryptobot.transfer({
          userId:  order.buyer_id,
          asset:   order.currency,
          amount:  order.amount,
          spendId: `refund_${orderId}`,
          comment: `Возврат по заказу #${orderId}`,
        });
      } catch (err) {
        logger.error('Cancel refund transfer error', { msg: err.message });
        return ctx.reply(
          `❌ Не удалось вернуть деньги покупателю: ${err.message}\n\n` +
          `Статус заказа не изменён — попробуйте ещё раз или используйте API:\n` +
          `POST /api/admin/orders/${orderId}/refund`
        );
      }
    }

    await db.updateOne('orders', {
      status:      'refunded',
      refunded_at: new Date().toISOString(),
    }, { id: orderId });

    await ctx.reply(
      `✅ Заказ #${orderId} закрыт${wasPaid ? ' и средства возвращены покупателю' : ''}.\n\n` +
      `Услуга: ${order.service_title}\n` +
      `Сумма: ${order.amount} ${order.currency}\n` +
      `Покупатель ID: ${order.buyer_id}\n` +
      `Продавец ID: ${order.seller_id}`
    );

    try {
      await ctx.telegram.sendMessage(
        order.buyer_id,
        `ℹ️ Заказ #${orderId} (<b>${escapeHtml(order.service_title)}</b>) закрыт администратором.\n` +
        (wasPaid ? `Средства в размере <b>${order.amount} ${escapeHtml(order.currency)}</b> возвращены на ваш @CryptoBot кошелёк.` : ''),
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
      `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
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

  // Buyer confirms delivery → trigger transfer (logic lives in escrow.js)
  bot.action(/^confirm_(\d+)$/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const order = await db.findOne('orders', { id: orderId });

    if (!order) return ctx.answerCbQuery('Заказ не найден');
    if (order.buyer_id !== ctx.from.id) return ctx.answerCbQuery('Нет доступа');
    if (!['in_progress', 'delivered'].includes(order.status)) return ctx.answerCbQuery('Уже обработано');

    try {
      await completeOrder(orderId);
    } catch (err) {
      logger.error('Transfer error (bot confirm)', { msg: err.message });
      await ctx.answerCbQuery('Ошибка перевода');
      return ctx.reply(
        `❌ Ошибка перевода:\n<code>${escapeHtml(err.message)}</code>\n\nОбратитесь к администратору.`,
        { parse_mode: 'HTML' }
      );
    }

    await ctx.answerCbQuery('🎉 Оплата переведена!');
    await ctx.editMessageText(
      `🎉 <b>Заказ #${orderId} завершён!</b>\n\n` +
      `<b>${order.seller_amount} ${escapeHtml(order.currency)}</b> переведены исполнителю через @CryptoBot.\n\nСпасибо за использование CoreTalent!`,
      { parse_mode: 'HTML' }
    );
  });

  // Buyer opens dispute
  bot.action(/^dispute_(\d+)$/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const order = await db.findOne('orders', { id: orderId });

    if (!order) return ctx.answerCbQuery('Заказ не найден');
    if (order.buyer_id !== ctx.from.id) return ctx.answerCbQuery('Нет доступа');
    if (!['in_progress', 'delivered'].includes(order.status))
      return ctx.answerCbQuery('Спор нельзя открыть в текущем статусе');

    await db.updateOne('orders', {
      status:      'disputed',
      disputed_at: new Date().toISOString(),
    }, { id: orderId });

    await ctx.answerCbQuery('Спор открыт');
    await ctx.editMessageText(
      `⚠️ <b>Спор открыт по заказу #${orderId}</b>\n\nАдминистратор разберётся и свяжется с вами в ближайшее время.`,
      { parse_mode: 'HTML' }
    );

    // Уведомить продавца
    try {
      await ctx.telegram.sendMessage(
        order.seller_id,
        `⚠️ <b>Покупатель открыл спор по заказу #${orderId}</b>\n\n` +
        `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
        `Администратор рассмотрит ситуацию и свяжется с вами. ` +
        `Пожалуйста, не предпринимайте действий вне платформы.`,
        { parse_mode: 'HTML' }
      );
    } catch {}

    // Уведомить администраторов
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
    for (const adminId of adminIds) {
      await ctx.telegram.sendMessage(
        adminId,
        `🚨 <b>Спор! Заказ #${orderId}</b>\n\n` +
        `Услуга: ${escapeHtml(order.service_title)}\n` +
        `Покупатель: ${order.buyer_id}\n` +
        `Продавец: ${order.seller_id}\n` +
        `Сумма: ${order.amount} ${escapeHtml(order.currency)}\n\n` +
        `Для возврата средств: /cancel ${orderId}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  return bot;
}

module.exports = { createBot };
