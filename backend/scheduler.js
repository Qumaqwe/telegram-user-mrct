/**
 * scheduler.js — фоновые задачи, запускаются один раз при старте сервера.
 *
 * Задачи:
 *  1. checkOverdueOrders — каждый час проверяет заказы с истёкшим сроком
 *     и отправляет напоминание продавцу (один раз на заказ).
 *     Также уведомляет покупателя что срок прошёл и предлагает открыть спор.
 */

const { db }    = require('./database');
const { escapeHtml, notifyViaBot, logger } = require('./utils');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // каждый час

async function checkOverdueOrders(bot) {
  try {
    // Выбираем заказы в работе без уже отправленного напоминания
    const { rows: orders } = await db.query(`
      SELECT * FROM orders
      WHERE status = 'in_progress'
        AND reminder_sent_at IS NULL
        AND paid_at IS NOT NULL
    `);

    const now = Date.now();

    for (const order of orders) {
      const paidAt      = new Date(order.paid_at).getTime();
      const deadlineMs  = (order.delivery_days || 1) * 24 * 60 * 60 * 1000;
      const deadlineAt  = paidAt + deadlineMs;

      if (now < deadlineAt) continue; // срок ещё не истёк

      logger.info('Overdue order detected', { spendId: `order_${order.id}` });

      // Отметить напоминание отправленным до отправки — чтобы повторный запуск
      // не отправил дубль если Telegram API ответит медленно
      await db.updateOne('orders', {
        reminder_sent_at: new Date().toISOString(),
      }, { id: order.id });

      // Уведомить продавца
      try {
        await bot.telegram.sendMessage(
          order.seller_id,
          `⏰ <b>Срок выполнения заказа #${order.id} истёк</b>\n\n` +
          `Услуга: <b>${escapeHtml(order.service_title)}</b>\n` +
          `Срок был: <b>${order.delivery_days} дн.</b>\n\n` +
          `Пожалуйста, завершите работу и нажмите кнопку "Выполнено", ` +
          `или свяжитесь с покупателем для продления срока.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.error('Reminder: failed to notify seller', { msg: err.message });
      }

      // Уведомить покупателя
      try {
        await bot.telegram.sendMessage(
          order.buyer_id,
          `⏰ <b>Срок выполнения заказа #${order.id} истёк</b>\n\n` +
          `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
          `Продавец получил напоминание. Если работа не будет выполнена — ` +
          `вы можете открыть спор через маркет или сообщить нам: /report`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.error('Reminder: failed to notify buyer', { msg: err.message });
      }
    }
  } catch (err) {
    logger.error('checkOverdueOrders error', { msg: err.message });
  }
}

function startScheduler(bot) {
  logger.info('Scheduler started', { intervalMs: CHECK_INTERVAL_MS });

  // Первый запуск через минуту после старта (дать серверу полностью подняться)
  setTimeout(() => {
    checkOverdueOrders(bot);
    setInterval(() => checkOverdueOrders(bot), CHECK_INTERVAL_MS);
  }, 60 * 1000);
}

module.exports = { startScheduler };
