import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';

export default function Profile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { getMe } = useApi();
  const { user, tg } = useTelegram();

  useEffect(() => {
    getMe().then((res) => setData(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const orders   = data?.orders || [];
  const incoming = data?.incoming_orders || [];
  const services = data?.services || [];

  const stats = [
    { label: 'Моих услуг',    value: services.filter((s) => s.status === 'active').length, icon: '💼' },
    { label: 'Сделано заказов', value: orders.filter((o) => o.status === 'completed').length, icon: '✅' },
    { label: 'Выполнено',      value: incoming.filter((o) => o.status === 'completed').length, icon: '📦' },
    { label: 'Заработано',     value: `${(data?.earned || 0).toFixed(2)}`, icon: '💰', sub: 'TON/USDT' },
  ];

  return (
    <div style={{ padding: '16px 16px 90px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>👤 Профиль</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Статистика и настройки</p>
      </div>

      {/* User card */}
      <div className="card" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%', background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '24px', fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {(user?.first_name || 'U')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '18px' }}>
              {user?.first_name} {user?.last_name || ''}
            </div>
            {user?.username && (
              <div style={{ color: 'var(--accent)', fontSize: '14px' }}>@{user.username}</div>
            )}
            {data?.rating && (
              <div style={{ fontSize: '13px', color: '#f5c842', marginTop: '2px' }}>
                ★ {data.rating} ({data.reviews_count} отзывов)
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loader" />
      ) : (
        <>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            {stats.map((s) => (
              <div key={s.label} className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>{s.icon}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent)' }}>
                  {s.value}
                  {s.sub && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '3px' }}>{s.sub}</span>}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* CryptoBot notice */}
          <div className="card" style={{ marginBottom: '12px', border: '1px solid rgba(124,106,247,0.3)' }}>
            <h3 style={{ fontWeight: 600, marginBottom: '10px', fontSize: '15px' }}>💎 Для получения выплат</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '12px' }}>
              Выплаты за выполненные заказы отправляются автоматически через <strong>@CryptoBot</strong>.
              Чтобы получать деньги — убедись, что запустил его.
            </p>
            <button className="btn btn-primary btn-full" style={{ fontSize: '14px' }}
              onClick={() => tg?.openTelegramLink('https://t.me/CryptoBot')}>
              Открыть @CryptoBot
            </button>
          </div>

          {/* How it works */}
          <div className="card">
            <h3 style={{ fontWeight: 600, marginBottom: '10px', fontSize: '15px' }}>ℹ️ Как работает эскроу</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {[
                { icon: '🛒', text: 'Покупатель оплачивает заказ через @CryptoBot' },
                { icon: '🔒', text: 'Деньги заморожены в эскроу до подтверждения' },
                { icon: '💼', text: 'Исполнитель выполняет и нажимает "Готово"' },
                { icon: '✅', text: 'Покупатель подтверждает → деньги переводятся автоматически' },
                { icon: '💰', text: 'Платформа берёт комиссию 5%' },
              ].map((item) => (
                <div key={item.text} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ lineHeight: 1.5 }}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
