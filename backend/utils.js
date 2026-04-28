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
    console.error('Bot notify error:', err.message);
  }
}

module.exports = { escapeHtml, notifyViaBot };
