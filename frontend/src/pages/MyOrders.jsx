import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';
import ServiceCard from '../components/ServiceCard';

const STATUS_LABELS = {
  pending_payment: { label: '⏳ Ожидает оплаты', cls: 'badge-pending' },
  in_progress:     { label: '🔨 В работе',        cls: 'badge-active' },
  delivered:       { label: '📦 На проверке',     cls: 'badge-pending' },
  completed:       { label: '✅ Завершён',         cls: 'badge-active' },
  disputed:        { label: '⚠️ Спор',            cls: 'badge-sold' },
  refunded:        { label: '↩️ Возврат',          cls: 'badge-sold' },
};

function ContactLink({ username, name, label }) {
  const { tg } = useTelegram();

  if (!username) {
    return (
      <div style={{
        fontSize: '12px', color: 'var(--text-secondary)',
        padding: '6px 10px', background: 'var(--bg-input)',
        borderRadius: 'var(--radius-sm)',
      }}>
        💬 {label || name}: нет username — свяжитесь через бота
      </div>
    );
  }

  return (
    <button
      className="btn btn-secondary"
      style={{ fontSize: '12px', padding: '6px 10px' }}
      onClick={() => {
        const url = `https://t.me/${username}`;
        if (tg?.openTelegramLink) tg.openTelegramLink(url);
        else window.open(url, '_blank');
      }}
    >
      💬 Написать @{username}
    </button>
  );
}

function OrderCard({ order, role, onConfirm, onDispute, onDeliver }) {
  const status = STATUS_LABELS[order.status] || { label: order.status, cls: 'badge-pending' };
  const otherName     = role === 'buyer' ? order.seller_name     : order.buyer_name;
  const otherUsername = role === 'buyer' ? order.seller_username : order.buyer_username;
  const showContact   = !['completed', 'refunded'].includes(order.status);

  return (
    <div className="card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>
            {order.service_title}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {role === 'buyer' ? `Исполнитель: ${otherName}` : `Покупатель: ${otherName}`}
            {otherUsername && (
              <span style={{ color: 'var(--accent)', marginLeft: '4px' }}>@{otherUsername}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '8px' }}>
          <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{order.amount} {order.currency}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>#{order.id}</div>
        </div>
      </div>

      {/* Status + date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className={`badge ${status.cls}`}>{status.label}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {new Date(order.created_at).toLocaleDateString('ru-RU')}
        </span>
      </div>

      {/* Requirements */}
      {order.requirements && (
        <div style={{
          background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
          padding: '10px', fontSize: '13px', color: 'var(--text-secondary)',
        }}>
          📋 {order.requirements}
        </div>
      )}

      {/* Seller: pending_payment hint */}
      {role === 'seller' && order.status === 'pending_payment' && (
        <div style={{
          background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
          padding: '10px', fontSize: '13px', color: 'var(--text-secondary)',
        }}>
          ⏳ Ожидаем оплаты от покупателя. Вам поступит уведомление после оплаты.
        </div>
      )}

      {/* Contact button */}
      {showContact && (
        <ContactLink
          username={otherUsername}
          name={otherName}
          label={role === 'buyer' ? 'исполнителя' : 'заказчика'}
        />
      )}

      {/* Seller: mark delivered */}
      {role === 'seller' && order.status === 'in_progress' && (
        <button className="btn btn-primary" onClick={() => onDeliver(order)}>
          ✅ Заказ выполнен — уведомить покупателя
        </button>
      )}

      {/* Seller: waiting for buyer confirm */}
      {role === 'seller' && order.status === 'delivered' && (
        <div style={{
          background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
          padding: '10px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center',
        }}>
          ⏳ Ожидаем подтверждения от покупателя...
        </div>
      )}

      {/* Buyer: confirm or dispute */}
      {role === 'buyer' && order.status === 'delivered' && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={() => onConfirm(order)}>
            ✅ Принять и оплатить
          </button>
          <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => onDispute(order)}>
            ❌ Спор
          </button>
        </div>
      )}

      {/* Buyer: in progress hint */}
      {role === 'buyer' && order.status === 'in_progress' && (
        <div style={{
          background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)',
          padding: '10px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center',
        }}>
          🔨 Исполнитель работает над заказом
        </div>
      )}
    </div>
  );
}

function ConfirmModal({ order, onClose, onDone }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const { confirmOrder } = useApi();
  const { showAlert, haptic } = useTelegram();

  const handleConfirm = async () => {
    haptic('heavy');
    setLoading(true);
    try {
      await confirmOrder(order.id, { rating, comment });
      onDone();
    } catch (err) {
      showAlert(err?.response?.data?.error || 'Ошибка подтверждения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end', zIndex: 200,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px max(24px, env(safe-area-inset-bottom))', width: '100%',
        border: '1px solid var(--border)',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>Подтвердить выполнение</h2>

        <div style={{ background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)', padding: '12px', marginBottom: '16px', fontSize: '14px' }}>
          <div><strong>{order.seller_amount} {order.currency}</strong> переведутся исполнителю через @CryptoBot</div>
        </div>

        <div className="input-group">
          <label>Оценка исполнителя</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setRating(s)}
                style={{
                  flex: 1, padding: '10px', border: 'none', borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer', fontSize: '18px',
                  background: rating >= s ? 'rgba(245,200,66,0.2)' : 'var(--bg-input)',
                  color: rating >= s ? '#f5c842' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <div className="input-group">
          <label>Комментарий (необязательно)</label>
          <textarea className="input-field" rows={3} placeholder="Всё отлично, рекомендую!"
            value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm} disabled={loading}>
            {loading ? '⏳ Отправка...' : '✅ Подтвердить и оплатить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyOrders() {
  const [data, setData] = useState(null);
  const [myServices, setMyServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('services');
  const [confirmModal, setConfirmModal] = useState(null);
  const { getMyOrders, getMe, deleteService, disputeOrder, deliverOrder } = useApi();
  const { showAlert, haptic } = useTelegram();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersRes, meRes] = await Promise.all([getMyOrders(), getMe()]);
      setData(ordersRes.data);
      setMyServices(meRes.data.services || []);
    } catch {
      showAlert('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleDeleteService = async (id) => {
    haptic('medium');
    try {
      await deleteService(id);
      fetchData();
    } catch (err) {
      showAlert(err?.response?.data?.error || 'Ошибка удаления');
    }
  };

  const handleDeliver = async (order) => {
    haptic('medium');
    try {
      await deliverOrder(order.id);
      showAlert('📦 Покупатель уведомлён о выполнении заказа!');
      fetchData();
    } catch (err) {
      showAlert(err?.response?.data?.error || 'Ошибка');
    }
  };

  const handleDispute = async (order) => {
    haptic('medium');
    try {
      await disputeOrder(order.id, { reason: 'Запрос покупателя' });
      showAlert('Спор открыт. Администратор свяжется с вами.');
      fetchData();
    } catch (err) {
      showAlert(err?.response?.data?.error || 'Ошибка');
    }
  };

  const activeServices = myServices.filter((s) => s.status === 'active');
  const buyerOrders  = data?.as_buyer  || [];
  const sellerOrders = data?.as_seller || [];

  const tabs = [
    { key: 'services', label: `Мои услуги (${activeServices.length})` },
    { key: 'buying',   label: `Заказы (${buyerOrders.length})` },
    { key: 'selling',  label: `Входящие (${sellerOrders.length})` },
  ];

  return (
    <div style={{ padding: '16px 16px 90px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>📋 Моё</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Услуги и заказы</p>
      </div>

      {loading ? (
        <div className="loader" />
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', overflowX: 'auto' }}>
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="btn"
                style={{
                  flexShrink: 0, fontSize: '12px', padding: '7px 12px',
                  background: tab === t.key ? 'var(--accent)' : 'var(--bg-input)',
                  color: tab === t.key ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* My services */}
          {tab === 'services' && (
            activeServices.length === 0 ? (
              <div className="empty-state">
                <div className="icon">💼</div>
                <p>Нет активных услуг</p>
                <p style={{ fontSize: '13px', marginTop: '8px' }}>
                  Создай услугу через вкладку «Создать»
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activeServices.map((s) => (
                  <ServiceCard key={s.id} service={s} isOwner onDelete={handleDeleteService} />
                ))}
              </div>
            )
          )}

          {/* Buyer orders */}
          {tab === 'buying' && (
            buyerOrders.length === 0 ? (
              <div className="empty-state">
                <div className="icon">🛒</div>
                <p>Ты ещё ничего не заказывал</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {buyerOrders.map((o) => (
                  <OrderCard key={o.id} order={o} role="buyer"
                    onConfirm={(order) => setConfirmModal(order)}
                    onDispute={handleDispute}
                  />
                ))}
              </div>
            )
          )}

          {/* Seller orders */}
          {tab === 'selling' && (
            sellerOrders.length === 0 ? (
              <div className="empty-state">
                <div className="icon">📦</div>
                <p>Входящих заказов пока нет</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {sellerOrders.map((o) => (
                  <OrderCard key={o.id} order={o} role="seller"
                    onConfirm={() => {}} onDispute={handleDispute} onDeliver={handleDeliver}
                  />
                ))}
              </div>
            )
          )}
        </>
      )}

      {confirmModal && (
        <ConfirmModal
          order={confirmModal}
          onClose={() => setConfirmModal(null)}
          onDone={() => {
            setConfirmModal(null);
            showAlert('🎉 Оплата переведена исполнителю!');
            fetchData();
          }}
        />
      )}
    </div>
  );
}
