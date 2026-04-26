import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';

const CATEGORIES = [
  { key: 'design',      label: '🎨 Дизайн' },
  { key: 'dev',         label: '💻 Разработка' },
  { key: 'copywriting', label: '✍️ Копирайтинг' },
  { key: 'marketing',   label: '📢 Маркетинг' },
  { key: 'translation', label: '🌐 Переводы' },
  { key: 'video',       label: '🎬 Видео' },
  { key: 'other',       label: '📦 Другое' },
];

export default function CreateService() {
  const navigate = useNavigate();
  const { createService } = useApi();
  const { haptic, showAlert } = useTelegram();

  const [form, setForm] = useState({
    title: '', description: '', category: '', price: '', currency: 'TON', delivery_days: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const validate = () => {
    const e = {};
    if (!form.title || form.title.length < 5)    e.title = 'Минимум 5 символов';
    if (!form.category)                           e.category = 'Выберите категорию';
    if (!form.description || form.description.length < 20) e.description = 'Минимум 20 символов';
    const p = parseFloat(form.price);
    if (!form.price || isNaN(p) || p < 0.1)      e.price = 'Минимум 0.1';
    const d = parseInt(form.delivery_days);
    if (!form.delivery_days || isNaN(d) || d < 1 || d > 90) e.delivery_days = '1–90 дней';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    haptic('medium');
    setLoading(true);
    setErrors({});
    try {
      await createService({ ...form, price: parseFloat(form.price), delivery_days: parseInt(form.delivery_days) });
      setSuccess(true);
      haptic('heavy');
    } catch (err) {
      showAlert(err?.response?.data?.error || 'Ошибка при создании');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{
        padding: '16px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center',
      }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>Услуга опубликована!</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          «{form.title}» теперь видна всем пользователям
        </p>
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <button className="btn btn-secondary btn-full" onClick={() => { setForm({ title: '', description: '', category: '', price: '', currency: 'TON', delivery_days: '' }); setSuccess(false); }}>
            + Ещё услугу
          </button>
          <button className="btn btn-primary btn-full" onClick={() => navigate('/my-orders')}>
            Мои услуги
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 100px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>➕ Новая услуга</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Расскажи, что умеешь делать</p>
      </div>

      {/* CryptoBot notice */}
      <div className="card" style={{ marginBottom: '16px', background: 'rgba(124,106,247,0.08)', border: '1px solid rgba(124,106,247,0.3)' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          💡 <strong style={{ color: 'var(--text)' }}>Для получения оплаты:</strong><br />
          Запусти <strong>@CryptoBot</strong> в Telegram — выплаты придут автоматически после подтверждения заказа.<br />
          Комиссия платформы: <strong>5%</strong>
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Title */}
        <div className="input-group">
          <label>Заголовок услуги *</label>
          <input className="input-field" placeholder="Сделаю логотип за 24 часа" maxLength={100}
            value={form.title} onChange={(e) => set('title', e.target.value)} />
          {errors.title && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{errors.title}</span>}
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>{form.title.length}/100</span>
        </div>

        {/* Category */}
        <div className="input-group">
          <label>Категория *</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => set('category', c.key)}
                style={{
                  padding: '7px 14px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 500,
                  background: form.category === c.key ? 'var(--accent)' : 'var(--bg-input)',
                  color: form.category === c.key ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${form.category === c.key ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'all 0.15s',
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          {errors.category && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{errors.category}</span>}
        </div>

        {/* Description */}
        <div className="input-group">
          <label>Описание *</label>
          <textarea className="input-field" rows={5} maxLength={1000}
            placeholder="Подробно опиши что входит в услугу, твой опыт, примеры работ..."
            value={form.description} onChange={(e) => set('description', e.target.value)} />
          {errors.description && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{errors.description}</span>}
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>{form.description.length}/1000</span>
        </div>

        {/* Price + Currency */}
        <div className="input-group">
          <label>Цена *</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="input-field" type="number" placeholder="0.5" min="0.1" step="0.01"
              style={{ flex: 1 }}
              value={form.price} onChange={(e) => set('price', e.target.value)} />
            <div style={{ display: 'flex', background: 'var(--bg-input)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {['TON', 'USDT'].map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => set('currency', cur)}
                  style={{
                    padding: '0 16px', border: 'none', cursor: 'pointer', fontSize: '14px',
                    fontWeight: 600, background: form.currency === cur ? 'var(--accent)' : 'transparent',
                    color: form.currency === cur ? '#fff' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >
                  {cur}
                </button>
              ))}
            </div>
          </div>
          {errors.price && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{errors.price}</span>}
          {form.price && !isNaN(parseFloat(form.price)) && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Вы получите: <strong>{(parseFloat(form.price) * 0.95).toFixed(4)} {form.currency}</strong> (после комиссии 5%)
            </span>
          )}
        </div>

        {/* Delivery days */}
        <div className="input-group">
          <label>Срок выполнения (дней) *</label>
          <input className="input-field" type="number" placeholder="3" min="1" max="90"
            value={form.delivery_days} onChange={(e) => set('delivery_days', e.target.value)} />
          {errors.delivery_days && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{errors.delivery_days}</span>}
        </div>

        {/* Preview */}
        {form.title && form.price && form.category && (
          <div className="card" style={{ marginBottom: '16px', border: '1px solid var(--accent)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Предпросмотр:</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700 }}>{form.title}</div>
                <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '4px' }}>
                  {CATEGORIES.find((c) => c.key === form.category)?.label}
                  {form.delivery_days && ` · ⏱ ${form.delivery_days} дн.`}
                </div>
              </div>
              {form.price && (
                <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '16px' }}>
                  {form.price} {form.currency}
                </div>
              )}
            </div>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
          {loading ? '⏳ Публикация...' : '🚀 Опубликовать услугу'}
        </button>
      </form>
    </div>
  );
}
