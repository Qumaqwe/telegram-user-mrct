/**
 * scheduler.js — фоновые задачи, запускаются один раз при старте сервера.
 *
 * Задачи (запускаются каждый час):
 *
 *  1. checkOverdueOrders
 *     Когда срок (delivery_days) истёк → напомнить продавцу и покупателю (1 раз).
 *
 *  2. checkAutoRefund
 *     Когда срок + 2 дня истёк, а продавец так и не нажал «Выполнено»
 *     (status = in_progress) → автоматический возврат денег покупателю.
 *
 *  3. checkAutoComplete
 *     Когда продавец нажал «Выполнено» (status = delivered), но покупатель
 *     не подтвердил 3 дня → автоматически завершить и выплатить продавцу.
 */

const { db }        = require('./database');
const cryptobot     = require('./cryptobot');
const { completeOrder } = require('./escrow');
const { escapeHtml, logger } = require('./utils');

const CHECK_INTERVAL_MS  = 60 * 60 * 1000; // каждый час
const AUTO_REFUND_GRACE  = 2 * 24 * 60 * 60 * 1000; // +2 дня после дедлайна
const AUTO_COMPLETE_WAIT = 3 * 24 * 60 * 60 * 1000; // +3 дня после delivered_at

// ---------------------------------------------------------------------------
// 1. Напоминание при истечении срока
// ---------------------------------------------------------------------------
async function checkOverdueOrders(bot) {
  try {
    const { rows: orders } = await db.query(`
      SELECT * FROM orders
      WHERE status = 'in_progress'
        AND reminder_sent_at IS NULL
        AND paid_at IS NOT NULL
    `);

    const now = Date.now();

    for (const order of orders) {
      const deadlineAt = new Date(order.paid_at).getTime()
        + (order.delivery_days || 1) * 24 * 60 * 60 * 1000;

      if (now < deadlineAt) continue;

      logger.info('Overdue order: sending reminder', { spendId: `order_${order.id}` });

      // Сохраняем до отправки — защита от дублей при медленном Telegram API
      await db.updateOne('orders', {
        reminder_sent_at: new Date().toISOString(),
      }, { id: order.id });

      try {
        await bot.telegram.sendMessage(
          order.seller_id,
          `⏰ <b>Срок выполнения заказа #${order.id} истёк</b>\n\n` +
          `Услуга: <b>${escapeHtml(order.service_title)}</b>\n` +
          `Срок был: <b>${order.delivery_days} дн.</b>\n\n` +
          `Завершите работу и нажмите "Выполнено". ` +
          `Если не выполните в течение <b>2 дней</b> — средства будут автоматически возвращены покупателю.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.error('Reminder: failed to notify seller', { msg: err.message });
      }

      try {
        await bot.telegram.sendMessage(
          order.buyer_id,
          `⏰ <b>Срок выполнения заказа #${order.id} истёк</b>\n\n` +
          `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
          `Продавец получил предупреждение. Если работа не будет сдана в течение 2 дней — ` +
          `средства вернутся вам автоматически.`,
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

// ---------------------------------------------------------------------------
// 2. Автовозврат покупателю если продавец не выполнил в срок + 2 дня
// ---------------------------------------------------------------------------
async function checkAutoRefund(bot) {
  try {
    const { rows: orders } = await db.query(`
      SELECT * FROM orders
      WHERE status = 'in_progress'
        AND paid_at IS NOT NULL
    `);

    const now = Date.now();

    for (const order of orders) {
      const autoRefundAt = new Date(order.paid_at).getTime()
        + (order.delivery_days || 1) * 24 * 60 * 60 * 1000
        + AUTO_REFUND_GRACE;

      if (now < autoRefundAt) continue;

      logger.info('Auto-refund triggered', { spendId: `order_${order.id}` });

      // Обновляем статус сразу — защита от двойного списания при следующем цикле
      await db.updateOne('orders', {
        status:      'refunded',
        refunded_at: new Date().toISOString(),
      }, { id: order.id });

      try {
        await cryptobot.transfer({
          userId:  order.buyer_id,
          asset:   order.currency,
          amount:  order.amount,
          spendId: `auto_refund_${order.id}`,
          comment: `Автовозврат по заказу #${order.id}: срок выполнения истёк`,
        });
        logger.info('Auto-refund transfer completed', { spendId: `order_${order.id}` });
      } catch (err) {
        logger.error('Auto-refund transfer failed', { msg: err.message });
        // Откатываем статус назад чтобы можно было повторить вручную
        await db.updateOne('orders', {
          status:      'in_progress',
          refunded_at: null,
        }, { id: order.id });
        continue;
      }

      try {
        await bot.telegram.sendMessage(
          order.buyer_id,
          `✅ <b>Средства возвращены автоматически</b>\n\n` +
          `Заказ #${order.id}: <b>${escapeHtml(order.service_title)}</b>\n` +
          `Продавец не выполнил работу в срок.\n\n` +
          `<b>${order.amount} ${escapeHtml(order.currency)}</b> переведены на ваш @CryptoBot кошелёк.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.error('Auto-refund: failed to notify buyer', { msg: err.message });
      }

      try {
        await bot.telegram.sendMessage(
          order.seller_id,
          `❌ <b>Заказ #${order.id} закрыт автоматически</b>\n\n` +
          `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
          `Срок выполнения истёк и работа не была сдана. ` +
          `Средства возвращены покупателю.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.error('Auto-refund: failed to notify seller', { msg: err.message });
      }
    }
  } catch (err) {
    logger.error('checkAutoRefund error', { msg: err.message });
  }
}

// ---------------------------------------------------------------------------
// 3. Автовыплата продавцу если покупатель не подтвердил за 3 дня после сдачи
// ---------------------------------------------------------------------------
async function checkAutoComplete(bot) {
  try {
    const { rows: orders } = await db.query(`
      SELECT * FROM orders
      WHERE status = 'delivered'
        AND delivered_at IS NOT NULL
    `);

    const now = Date.now();

    for (const order of orders) {
      const autoCompleteAt = new Date(order.delivered_at).getTime() + AUTO_COMPLETE_WAIT;

      if (now < autoCompleteAt) continue;

      logger.info('Auto-complete triggered', { spendId: `order_${order.id}` });

      try {
        await completeOrder(order.id);
        logger.info('Auto-complete transfer done', { spendId: `order_${order.id}` });
      } catch (err) {
        logger.error('Auto-complete transfer failed', { msg: err.message });
        continue;
      }

      try {
        await bot.telegram.sendMessage(
          order.buyer_id,
          `ℹ️ <b>Заказ #${order.id} завершён автоматически</b>\n\n` +
          `Услуга: <b>${escapeHtml(order.service_title)}</b>\n\n` +
          `Вы не подтвердили получение в течение 3 дней после сдачи работы — ` +
          `средства переведены исполнителю автоматически.\n\n` +
          `Если возникли проблемы — напишите /report`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        logger.error('Auto-complete: failed to notify buyer', { msg: err.message });
      }
    }
  } catch (err) {
    logger.error('checkAutoComplete error', { msg: err.message });
  }
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------
function startScheduler(bot) {
  logger.info('Scheduler started', { intervalMs: CHECK_INTERVAL_MS });

  async function runAll() {
    await checkOverdueOrders(bot);
    await checkAutoRefund(bot);
    await checkAutoComplete(bot);
  }

  // Первый запуск через минуту после старта (дать серверу полностью подняться)
  setTimeout(() => {
    runAll();
    setInterval(runAll, CHECK_INTERVAL_MS);
  }, 60 * 1000);
}

module.exports = { startScheduler };
