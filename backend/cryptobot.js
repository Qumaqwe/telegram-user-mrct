const axios = require('axios');
const crypto = require('crypto');

const api = axios.create({
  baseURL: 'https://pay.crypt.bot/api',
  timeout: 10000,
  headers: { 'Crypto-Pay-API-Token': process.env.CRYPTOBOT_TOKEN },
});

// Extract meaningful error from axios error or CryptoBot ok:false response
function extractError(err) {
  if (err.response) {
    // CryptoBot returned an HTTP error (4xx/5xx)
    const d = err.response.data;
    const code = d?.error?.code || d?.error?.name || err.response.status;
    const name = d?.error?.name || d?.error?.message || JSON.stringify(d) || `HTTP ${err.response.status}`;
    console.error('CryptoBot HTTP error:', err.response.status, JSON.stringify(d));
    return new Error(`CryptoBot [${code}]: ${name}`);
  }
  return err;
}

async function createInvoice({ asset = 'TON', amount, description, payload }) {
  try {
    const { data } = await api.post('/createInvoice', {
      asset,
      amount:      String(amount),
      description,
      payload:     typeof payload === 'string' ? payload : JSON.stringify(payload),
      allow_comments:   false,
      allow_anonymous:  false,
    });
    if (!data.ok) throw new Error(`CryptoBot: ${data.error?.name || JSON.stringify(data.error)}`);
    return data.result;
  } catch (err) {
    throw extractError(err);
  }
}

async function getInvoice(invoiceId) {
  try {
    const { data } = await api.get('/getInvoices', {
      params: { invoice_ids: String(invoiceId) },
    });
    if (!data.ok) throw new Error(`CryptoBot: ${data.error?.name || JSON.stringify(data.error)}`);
    return data.result.items[0] || null;
  } catch (err) {
    throw extractError(err);
  }
}

async function transfer({ userId, asset = 'TON', amount, spendId, comment }) {
  console.log('CryptoBot transfer →', { userId, asset, amount: String(amount), spendId });
  try {
    const { data } = await api.post('/transfer', {
      user_id:                  userId,
      asset,
      amount:                   String(amount),
      spend_id:                 String(spendId),
      comment:                  comment || '',
      disable_send_notification: false,
    });
    if (!data.ok) throw new Error(`CryptoBot: ${data.error?.name || JSON.stringify(data.error)}`);
    console.log('CryptoBot transfer ✓', data.result);
    return data.result;
  } catch (err) {
    throw extractError(err);
  }
}

async function getBalance() {
  try {
    const { data } = await api.get('/getBalance');
    if (!data.ok) throw new Error(`CryptoBot: ${data.error?.name || JSON.stringify(data.error)}`);
    return data.result;
  } catch (err) {
    throw extractError(err);
  }
}

// rawBody must be the original request body as a Buffer or string —
// re-serialising a parsed object would change key order and break the HMAC.
function verifyWebhookSignature(rawBody, signature) {
  const secret = crypto.createHash('sha256').update(process.env.CRYPTOBOT_TOKEN).digest();
  const hmac   = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return hmac === signature;
}

module.exports = { createInvoice, getInvoice, transfer, getBalance, verifyWebhookSignature };
