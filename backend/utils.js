/**
 * Minimal structured logger with configurable level via LOG_LEVEL env var.
 * Levels: error | warn | info | debug  (default: info)
 *
 * Sensitive fields (Telegram IDs, transfer amounts) are intentionally kept out
 * of INFO/DEBUG logs — use LOG_LEVEL=debug only on trusted dev machines.
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const logger = {
  error: (msg, meta) => {
    if (currentLevel >= 0)
      console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), msg, ...sanitize(meta) }));
  },
  warn: (msg, meta) => {
    if (currentLevel >= 1)
      console.warn(JSON.stringify({ level: 'warn',  ts: new Date().toISOString(), msg, ...sanitize(meta) }));
  },
  info: (msg, meta) => {
    if (currentLevel >= 2)
      console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), msg, ...sanitize(meta) }));
  },
  debug: (msg, meta) => {
    if (currentLevel >= 3)
      console.log(JSON.stringify({ level: 'debug', ts: new Date().toISOString(), msg, ...sanitize(meta) }));
  },
};

/** Remove or mask fields that must not appear in production logs. */
function sanitize(meta) {
  if (!meta || typeof meta !== 'object') return meta ? { detail: meta } : {};
  const out = { ...meta };
  if (out.userId   !== undefined) out.userId   = maskId(out.userId);
  if (out.buyer_id !== undefined) out.buyer_id = maskId(out.buyer_id);
  if (out.seller_id !== undefined) out.seller_id = maskId(out.seller_id);
  return out;
}

function maskId(id) {
  const s = String(id);
  return `***${s.slice(-3)}`;
}

/**
 * Escape special HTML characters to prevent injection in Telegram HTML-mode messages.
 * Applied to all user-generated content before inserting into parse_mode:'HTML' strings.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send a Telegram message via the running bot instance.
 * Silently swallows errors so a notification failure never breaks business logic.
 */
async function notifyViaBot(fn) {
  try {
    const botInstance = require('./botInstance');
    const bot = botInstance.get();
    if (bot) await fn(bot);
  } catch (err) {
    logger.error('Bot notify error', { msg: err.message });
  }
}

/** Фрагмент HTML для уведомления продавца об оплате заказа */
function cryptobotSellerOrderPaidHintHtml() {
  return (
    `\n\n💎 <b>Выплата:</b> после заказа деньги приходят только на баланс <b>@CryptoBot</b>. ` +
    `Если вы ещё не открывали этого бота — зайдите в <a href="https://t.me/CryptoBot">t.me/CryptoBot</a> и нажмите «Старт», иначе автоматический перевод может не выполниться.`
  );
}

function isCryptobotUserMissingError(err) {
  return !!(err && typeof err.message === 'string' && err.message.includes('USER_NOT_FOUND'));
}

/** Личное сообщение продавцу: без активации CryptoBot выплата не дойдёт */
async function notifySellerCryptobotRequiredForPayout(sellerTelegramId, opts = {}) {
  const orderId = opts.orderId;
  const orderLine = orderId !== undefined && orderId !== null
    ? `Заказ <b>#${escapeHtml(String(orderId))}</b>: перевод не выполнен — чаще всего это значит, что вы ещё не активировали <b>@CryptoBot</b>.\n\n`
    : '';

  await notifyViaBot(async (bot) => {
    try {
      await bot.telegram.sendMessage(
        sellerTelegramId,
        `⚠️ <b>Нужен @CryptoBot для получения выплаты</b>\n\n` +
        orderLine +
        `Откройте <a href="https://t.me/CryptoBot">t.me/CryptoBot</a> и нажмите «Старт». ` +
        `После этого попросите покупателя снова подтвердить заказ в приложении CoreTalent (или дождитесь автоподтверждения через 3 дня после того, как вы отметили заказ выполненным).\n\n` +
        `Подробнее: /help`,
        { parse_mode: 'HTML', disable_web_page_preview: true }
      );
    } catch (err) {
      logger.error('Seller CryptoBot reminder DM failed', { msg: err.message });
    }
  });
}

module.exports = {
  escapeHtml,
  notifyViaBot,
  logger,
  cryptobotSellerOrderPaidHintHtml,
  isCryptobotUserMissingError,
  notifySellerCryptobotRequiredForPayout,
};
