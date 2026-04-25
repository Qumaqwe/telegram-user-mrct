import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';

export default function Profile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { getMe, register } = useApi();
  const { user: tgUser, tg } = useTelegram();

  useEffect(() => {
    // Сначала регистрируем (на случай если App ещё не успел), потом получаем профиль
    register()
      .catch(() => {})
      .finally(() => {
        getMe()
          .then((res) => setData(res.data))
          .catch(() => {})
          .finally(() => setLoading(false));
      });
  }, []);

  // Данные пользователя: из БД или из Telegram (что доступно)
  const dbUser  = data?.user;
  const name       = dbUser?.first_name || tgUser?.first_name || '—';
  const lastName   = dbUser?.last_name  || tgUser?.last_name  || '';
  const username   = dbUser?.username   || tgUser?.username   || null;
  const userId     = dbUser?.telegram_id ?? tgUser?.id ?? null;

  const stats = {
    active:  data?.listings?.filter((l) => l.status === 'active').length  || 0,
    sold:    data?.listings?.filter((l) => l.status === 'sold').length    || 0,
    earned:  data?.listings?.filter((l) => l.status === 'sold').reduce((s, l) => s + l.price, 0) || 0,
    spent:   data?.purchases?.reduce((s, p) => s + p.amount, 0) || 0,
  };

  return (
    <div style={{ padding: '16px 16px 90px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>👤 Профиль</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Твоя статистика</p>
      </div>

      {loading ? (
        <div className="loader" />
      ) : (
        <>
          {/* User info */}
          <div className="card" style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '56px', height: '56px', borderRadius: '50%',
                background: 'var(--accent)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '24px', fontWeight: 700, color: '#fff',
                flexShrink: 0,
              }}>
                {name[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '18px' }}>
                  {name} {lastName}
                </div>
                {username && (
                  <div style={{ color: 'var(--accent)', fontSize: '14px' }}>@{username}</div>
                )}
                {userId !== null && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    ID: {userId}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            {[
              { label: 'Активных',   value: stats.active,                          icon: '📋' },
              { label: 'Продано',    value: stats.sold,                            icon: '✅' },
              { label: 'Заработано', value: `⭐ ${stats.earned.toLocaleString()}`, icon: '💰' },
              { label: 'Потрачено',  value: `⭐ ${stats.spent.toLocaleString()}`,  icon: '🛒' },
            ].map((s) => (
              <div key={s.label} className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>{s.icon}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent)' }}>{s.value}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Info block */}
          <div className="card" style={{ marginBottom: '12px' }}>
            <h3 style={{ fontWeight: 600, marginBottom: '10px', fontSize: '15px' }}>ℹ️ Как работает маркет</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              <div>🔹 Валюта: <strong style={{ color: 'var(--star)' }}>Telegram Stars (⭐)</strong></div>
              <div>🔹 Продажа: выставь объявление с ценой</div>
              <div>🔹 Покупка: найди юзернейм и оплати через бота</div>
              <div>🔹 Передача: через бота после оплаты</div>
            </div>
          </div>

          {/* Links */}
          <div className="card">
            <h3 style={{ fontWeight: 600, marginBottom: '10px', fontSize: '15px' }}>🔗 Полезные ссылки</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { label: '📖 Как передать юзернейм', url: 'https://telegram.org/faq#how-do-i-change-my-username' },
                { label: '💎 Что такое Telegram Stars', url: 'https://telegram.org/blog/telegram-stars' },
                { label: '🏷 Fragment (официальный аукцион)', url: 'https://fragment.com' },
              ].map((l) => (
                <button
                  key={l.url}
                  className="btn btn-secondary"
                  style={{ justifyContent: 'flex-start', padding: '10px 14px' }}
                  onClick={() => tg?.openLink(l.url)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
