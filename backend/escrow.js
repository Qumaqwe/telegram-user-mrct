/**
 * escrow.js — единая точка выплаты продавцу.
 *
 * Вызывается и из бота (callback confirm_*), и из API (POST /orders/:id/confirm).
 * CryptoBot spend_id = "order_<id>" обеспечивает идемпотентность перевода —
 * повторный вызов с тем же spend_id вернёт ошибку от CryptoBot, а не спишет дважды.
 */

const { db }          = require('./database');
const cryptobot       = require('./cryptobot');
const { escapeHtml, notifyViaBot } = require('./utils');

/**
 * Завершить заказ: перевести seller_amount продавцу, обновить статус,
 * сохранить отзыв (опционально) и уведомить продавца в Telegram.
 *
 * Бросает ошибку если перевод не прошёл — в этом случае статус заказа НЕ меняется.
 *
 * @param {number} orderId
 * @param {{ rating?: number|string, comment?: string }} [opts]
 * @returns {Promise<object>} строка заказа (до обновления статуса)
 */
async function completeOrder(orderId, { rating, comment } = {}) {
  const order = await db.findOne('orders', { id: orderId });
  if (!order) {
    const err = new Error('Заказ не найден');
    err.code = 'NOT_FOUND';
    throw err;
  }

  await cryptobot.transfer({
    userId:  order.seller_id,
    asset:   order.currency,
    amount:  order.seller_amount,
    spendId: `order_${orderId}`,
    comment: `Оплата за заказ #${orderId}: ${order.service_title}`,
  });

  await db.updateOne('orders', {
    status:       'completed',
    completed_at: new Date().toISOString(),
  }, { id: orderId });

  const parsedRating = parseInt(rating);
  if (parsedRating >= 1 && parsedRating <= 5) {
    await db.insertOne('reviews', {
      order_id:    orderId,
      reviewer_id: order.buyer_id,
      seller_id:   order.seller_id,
      rating:      parsedRating,
      comment:     comment || null,
      created_at:  new Date().toISOString(),
    }).catch((err) => console.error('Review insert error:', err.message));
  }

  await notifyViaBot(async (bot) => {
    await bot.telegram.sendMessage(
      order.seller_id,
      `🎉 <b>Оплата получена!</b>\n\n` +
      `Заказ #${orderId}: <b>${escapeHtml(order.service_title)}</b>\n` +
      `Сумма: <b>${order.seller_amount} ${escapeHtml(order.currency)}</b>\n\n` +
      `Деньги переведены на ваш @CryptoBot кошелёк!` +
      (parsedRating >= 1 && parsedRating <= 5 ? `\n⭐ Оценка: ${parsedRating}/5` : ''),
      { parse_mode: 'HTML' }
    );
  });

  return order;
}

module.exports = { completeOrder };
