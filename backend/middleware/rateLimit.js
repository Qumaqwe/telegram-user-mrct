const rateLimit = require('express-rate-limit');

const RATE_MSG = { error: 'Слишком много запросов. Подождите немного и попробуйте снова.' };

/**
 * Общий лимит для всех /api маршрутов.
 * 300 запросов в 15 минут с одного IP — достаточно для нормального использования.
 */
const generalLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            300,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        RATE_MSG,
});

/**
 * Создание заказа: не более 15 новых заказов за 15 минут с одного IP.
 * Защита от спама инвойсов в CryptoBot.
 */
const createOrderLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            15,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { error: 'Слишком много попыток создать заказ. Подождите 15 минут.' },
});

/**
 * Проверка оплаты: не более 60 запросов за 5 минут с одного IP.
 * Защита от перегрузки CryptoBot API при опросе статуса.
 */
const checkPaymentLimiter = rateLimit({
  windowMs:       5 * 60 * 1000,
  max:            60,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { error: 'Слишком много проверок оплаты. Подождите немного.' },
});

/**
 * Создание услуги/объявления: не более 20 за час с одного IP.
 */
const createContentLimiter = rateLimit({
  windowMs:       60 * 60 * 1000,
  max:            20,
  standardHeaders: true,
  legacyHeaders:  false,
  message:        { error: 'Слишком много публикаций. Попробуйте через час.' },
});

module.exports = { generalLimiter, createOrderLimiter, checkPaymentLimiter, createContentLimiter };
