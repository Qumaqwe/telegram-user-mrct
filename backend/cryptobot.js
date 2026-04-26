const axios = require('axios');
const crypto = require('crypto');

const api = axios.create({
  baseURL: 'https://pay.crypt.bot/api',
  timeout: 10000,
  headers: { 'Crypto-Pay-API-Token': process.env.CRYPTOBOT_TOKEN },
});

async function createInvoice({ asset = 'TON', amount, description, payload }) {
  const { data } = await api.post('/createInvoice', {
    asset,
    amount: String(amount),
    description,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    allow_comments: false,
    allow_anonymous: false,
  });
  if (!data.ok) throw new Error(data.error?.name || 'CryptoBot API error');
  return data.result;
}

async function getInvoice(invoiceId) {
  const { data } = await api.get('/getInvoices', {
    params: { invoice_ids: String(invoiceId) },
  });
  if (!data.ok) throw new Error(data.error?.name || 'CryptoBot API error');
  return data.result.items[0] || null;
}

async function transfer({ userId, asset = 'TON', amount, spendId, comment }) {
  const { data } = await api.post('/transfer', {
    user_id: userId,
    asset,
    amount: String(amount),
    spend_id: String(spendId),
    comment: comment || '',
    disable_send_notification: false,
  });
  if (!data.ok) throw new Error(data.error?.name || 'CryptoBot API error');
  return data.result;
}

async function getBalance() {
  const { data } = await api.get('/getBalance');
  if (!data.ok) throw new Error(data.error?.name || 'CryptoBot API error');
  return data.result;
}

function verifyWebhookSignature(body, signature) {
  const secret = crypto.createHash('sha256').update(process.env.CRYPTOBOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hmac === signature;
}

module.exports = { createInvoice, getInvoice, transfer, getBalance, verifyWebhookSignature };
