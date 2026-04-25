import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';
import ListingCard from '../components/ListingCard';

export default function MyListings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('selling');
  const { getMe, deleteListing } = useApi();
  const { showAlert } = useTelegram();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getMe();
      setData(res.data);
    } catch {
      showAlert('Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleDelete = async (listingId) => {
    try {
      await deleteListing(listingId);
      fetchData();
    } catch (err) {
      const msg = err?.response?.data?.error || 'Ошибка при удалении';
      showAlert(msg);
    }
  };

  const activeListings = data?.listings?.filter((l) => l.status === 'active') || [];
  const soldListings = data?.listings?.filter((l) => l.status === 'sold') || [];

  return (
    <div style={{ padding: '16px 16px 90px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>📋 Мои объявления</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Управление продажами и покупками</p>
      </div>

      {loading ? (
        <div className="loader" />
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {[
              { key: 'selling', label: `Продаю (${activeListings.length})` },
              { key: 'sold', label: `Продано (${soldListings.length})` },
              { key: 'purchased', label: `Куплено (${data?.purchases?.length || 0})` },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="btn"
                style={{
                  background: tab === t.key ? 'var(--accent)' : 'var(--bg-input)',
                  color: tab === t.key ? '#fff' : 'var(--text-secondary)',
                  fontSize: '13px',
                  padding: '8px 12px',
                  flex: 1,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Selling */}
          {tab === 'selling' && (
            activeListings.length === 0 ? (
              <div className="empty-state">
                <div className="icon">📦</div>
                <p>Нет активных объявлений</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activeListings.map((l) => (
                  <ListingCard key={l.id} listing={l} isOwner onDelete={handleDelete} onRefresh={fetchData} />
                ))}
              </div>
            )
          )}

          {/* Sold */}
          {tab === 'sold' && (
            soldListings.length === 0 ? (
              <div className="empty-state">
                <div className="icon">💸</div>
                <p>Ещё ничего не продано</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {soldListings.map((l) => (
                  <div key={l.id} className="card fade-in">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>@{l.username}</span>
                      <span className="stars">⭐ {l.price.toLocaleString()}</span>
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      ✓ Продан {new Date(l.created_at).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Purchased */}
          {tab === 'purchased' && (
            !data?.purchases?.length ? (
              <div className="empty-state">
                <div className="icon">🛒</div>
                <p>Ты ещё ничего не купил</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {data.purchases.map((tx) => (
                  <div key={tx.id} className="card fade-in">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>@{tx.username}</span>
                      <span className="stars">⭐ {tx.amount.toLocaleString()}</span>
                    </div>
                    <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className={`badge badge-${tx.status}`}>
                        {tx.status === 'completed' ? '✓ Завершено' : '⏳ Ожидание'}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {new Date(tx.created_at).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
