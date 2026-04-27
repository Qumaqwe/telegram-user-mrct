import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';
import ServiceCard, { CATEGORY_LABELS } from '../components/ServiceCard';

const CATEGORIES = [
  { key: '', label: '🌐 Все' },
  { key: 'design',      label: '🎨 Дизайн' },
  { key: 'dev',         label: '💻 Разработка' },
  { key: 'copywriting', label: '✍️ Тексты' },
  { key: 'marketing',   label: '📢 Маркетинг' },
  { key: 'translation', label: '🌐 Переводы' },
  { key: 'video',       label: '🎬 Видео' },
  { key: 'other',       label: '📦 Другое' },
];

// Modal for placing an order
function OrderModal({ service, onClose, onSuccess }) {
  const [requirements, setRequirements] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('form'); // form | paying
  const [orderId, setOrderId] = useState(null);
  const [checking, setChecking] = useState(false);
  const { createOrder, checkPayment } = useApi();
  const { tg, haptic, showAlert } = useTelegram();

  const handleCreate = async () => {
    haptic('medium');
    setLoading(true);
    try {
      const res = await createOrder(service.id, { requirements });
      const { order_id, pay_url } = res.data;
      setOrderId(order_id);
      setStep('paying');
      tg?.openLink(pay_url);
    } catch (err) {
      showAlert(err?.response?.data?.error || 'Ошибка создания заказа');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckPayment = async () => {
    setChecking(true);
    try {
      const res = await checkPayment(orderId);
      if (res.data.status === 'in_progress') {
        haptic('heavy');
        onSuccess();
      } else {
        showAlert('Оплата ещё не подтверждена. Оплатите в @CryptoBot и нажмите снова.');
      }
    } catch {
      showAlert('Ошибка проверки оплаты');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end', zIndex: 200,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px max(24px, env(safe-area-inset-bottom))',
        width: '100%', border: '1px solid var(--border)',
      }}>
        {step === 'form' ? (
          <>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>Оформить заказ</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
              {service.title}
            </p>

            <div style={{
              background: 'var(--accent-light)', border: '1px solid rgba(124,106,247,0.3)',
              borderRadius: 'var(--radius-sm)', padding: '12px', marginBottom: '16px', fontSize: '14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Стоимость</span>
                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{service.price} {service.currency}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Срок выполнения</span>
                <span>{service.delivery_days} дн.</span>
              </div>
            </div>

            <div className="input-group">
              <label>Ваши требования (необязательно)</label>
              <textarea
                className="input-field"
                placeholder="Опишите что нужно сделать, укажите детали..."
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                rows={4}
                maxLength={1000}
              />
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              ⚠️ Оплата через @CryptoBot. Деньги в эскроу до подтверждения выполнения.
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Отмена</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleCreate} disabled={loading}>
                {loading ? '⏳ Создание...' : `Оплатить ${service.price} ${service.currency}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>⏳</div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Ожидание оплаты</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                Оплатите заказ в @CryptoBot, затем нажмите кнопку ниже
              </p>
            </div>

            <div style={{
              background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
              padding: '12px', marginBottom: '16px', fontSize: '14px', textAlign: 'center',
            }}>
              Заказ #{orderId} · {service.price} {service.currency}
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={handleCheckPayment}
              disabled={checking}
              style={{ marginBottom: '10px' }}
            >
              {checking ? '⏳ Проверяем...' : '✅ Я оплатил — проверить'}
            </button>
            <button className="btn btn-secondary btn-full" onClick={onClose}>Закрыть</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('newest');
  const [error, setError] = useState(null);
  const [orderModal, setOrderModal] = useState(null);
  const { getServices } = useApi();
  const { showAlert } = useTelegram();

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getServices({ search: search || undefined, category: category || undefined, sort });
      setServices(res.data);
    } catch {
      setError('Не удалось загрузить услуги');
    } finally {
      setLoading(false);
    }
  }, [search, category, sort]);

  useEffect(() => {
    const t = setTimeout(fetchServices, 350);
    return () => clearTimeout(t);
  }, [fetchServices]);

  return (
    <div style={{ paddingBottom: '90px' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 0' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>FreelanceBot</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '14px' }}>
          Биржа фриланс-услуг с оплатой в TON/USDT
        </p>

        {/* Search + sort */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              className="input-field"
              placeholder="Поиск услуг..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input-field"
            style={{ width: 'auto', minWidth: '110px' }}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Новые</option>
            <option value="price_asc">Дешевле</option>
            <option value="price_desc">Дороже</option>
            <option value="rating">Рейтинг</option>
          </select>
        </div>
      </div>

      {/* Categories horizontal scroll */}
      <div style={{
        display: 'flex', gap: '8px', overflowX: 'auto', padding: '0 16px 12px',
        scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: '20px', border: 'none',
              cursor: 'pointer', fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap',
              background: category === c.key ? 'var(--accent)' : 'var(--bg-card)',
              color: category === c.key ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${category === c.key ? 'var(--accent)' : 'var(--border)'}`,
              transition: 'all 0.15s',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '0 16px' }}>
        {!loading && !error && (
          <div style={{
            background: 'var(--accent-light)', border: '1px solid rgba(124,106,247,0.3)',
            borderRadius: 'var(--radius-sm)', padding: '8px 14px',
            marginBottom: '14px', fontSize: '13px', color: 'var(--accent)',
          }}>
            Услуг найдено: <strong>{services.length}</strong>
          </div>
        )}

        {loading ? (
          <div className="loader" />
        ) : error ? (
          <div className="empty-state">
            <div className="icon">❌</div>
            <p>{error}</p>
            <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={fetchServices}>
              Повторить
            </button>
          </div>
        ) : services.length === 0 ? (
          <div className="empty-state">
            <div className="icon">😔</div>
            <p>Услуг не найдено</p>
            {(search || category) && (
              <button className="btn btn-secondary" style={{ marginTop: '12px' }}
                onClick={() => { setSearch(''); setCategory(''); }}>
                Сбросить фильтры
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {services.map((s) => (
              <ServiceCard
                key={s.id}
                service={s}
                onOrder={(service) => setOrderModal(service)}
              />
            ))}
          </div>
        )}
      </div>

      {orderModal && (
        <OrderModal
          service={orderModal}
          onClose={() => setOrderModal(null)}
          onSuccess={() => {
            setOrderModal(null);
            showAlert('✅ Оплата подтверждена! Заказ передан исполнителю.');
          }}
        />
      )}
    </div>
  );
}
