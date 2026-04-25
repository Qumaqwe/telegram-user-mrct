import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';

export default function Sell() {
  const navigate = useNavigate();
  const { createListing } = useApi();
  const { haptic, showAlert } = useTelegram();

  const [form, setForm] = useState({ username: '', description: '', price: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const newErrors = {};
    if (!form.username) newErrors.username = 'Введи юзернейм';
    else if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(form.username)) {
      newErrors.username = '5–32 символа, только латиница, цифры и _';
    }
    if (!form.price) newErrors.price = 'Укажи цену';
    else if (parseInt(form.price) < 1) newErrors.price = 'Минимум 1 ⭐';
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    haptic('medium');
    setLoading(true);
    setErrors({});
    try {
      await createListing({ ...form, price: parseInt(form.price) });
      setSuccess(true);
      haptic('heavy');
    } catch (err) {
      const msg = err?.response?.data?.error || 'Ошибка при создании объявления';
      showAlert(msg);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>Объявление опубликовано!</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          @{form.username} теперь доступен в маркете за {form.price} ⭐
        </p>
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <button className="btn btn-secondary btn-full" onClick={() => { setForm({ username: '', description: '', price: '' }); setSuccess(false); }}>
            + Ещё объявление
          </button>
          <button className="btn btn-primary btn-full" onClick={() => navigate('/my-listings')}>
            Мои объявления
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 90px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>💰 Продать юзернейм</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Заполни форму и жди покупателей
        </p>
      </div>

      {/* Инструкция */}
      <div className="card" style={{ marginBottom: '16px', background: 'var(--accent-light)', border: '1px solid rgba(124,106,247,0.3)' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          ⚠️ <strong style={{ color: 'var(--text)' }}>Важно перед продажей:</strong><br />
          1. Убедись, что юзернейм свободен или принадлежит тебе<br />
          2. После оплаты нужно вручную передать юзернейм покупателю<br />
          3. Для передачи юзернейма: Настройки → Изменить профиль → Юзернейм
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <label>Юзернейм для продажи</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent)', fontWeight: 700 }}>@</span>
            <input
              className="input-field"
              style={{ paddingLeft: '28px' }}
              placeholder="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value.replace('@', '').toLowerCase() })}
            />
          </div>
          {errors.username && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{errors.username}</span>}
        </div>

        <div className="input-group">
          <label>Цена (в Telegram Stars ⭐)</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }}>⭐</span>
            <input
              className="input-field"
              style={{ paddingLeft: '34px' }}
              type="number"
              placeholder="100"
              min="1"
              max="1000000"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
          {errors.price && <span style={{ color: 'var(--danger)', fontSize: '13px' }}>{errors.price}</span>}
          {form.price && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              ≈ ${(parseInt(form.price) * 0.013).toFixed(2)} USD
            </span>
          )}
        </div>

        <div className="input-group">
          <label>Описание (необязательно)</label>
          <textarea
            className="input-field"
            placeholder="Красивый короткий юзернейм, 6 символов..."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={300}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right' }}>
            {form.description.length}/300
          </span>
        </div>

        {/* Preview */}
        {form.username && (
          <div className="card" style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Предпросмотр:</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>@{form.username}</span>
              {form.price && <span className="stars">⭐ {parseInt(form.price).toLocaleString()}</span>}
            </div>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: '8px' }}>
          {loading ? '⏳ Публикация...' : '🚀 Опубликовать объявление'}
        </button>
      </form>
    </div>
  );
}
