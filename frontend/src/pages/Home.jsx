import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import ListingCard from '../components/ListingCard';

export default function Home() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [error, setError] = useState(null);
  const { getListings } = useApi();

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getListings({ search: search || undefined, sort });
      setListings(res.data);
    } catch {
      setError('Не удалось загрузить объявления');
    } finally {
      setLoading(false);
    }
  }, [search, sort]);

  useEffect(() => {
    const timer = setTimeout(fetchListings, 400);
    return () => clearTimeout(timer);
  }, [fetchListings]);

  return (
    <div style={{ padding: '16px 16px 90px' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>
          🏪 Username Market
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Покупай и продавай Telegram-юзернеймы
        </p>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{
            position: 'absolute', left: '12px', top: '50%',
            transform: 'translateY(-50%)', fontSize: '16px'
          }}>🔍</span>
          <input
            className="input-field"
            style={{ paddingLeft: '36px' }}
            placeholder="Поиск юзернейма..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input-field"
          style={{ width: 'auto', minWidth: '120px' }}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Новые</option>
          <option value="price_asc">Дешевле</option>
          <option value="price_desc">Дороже</option>
        </select>
      </div>

      {/* Stats bar */}
      {!loading && !error && (
        <div style={{
          background: 'var(--accent-light)',
          border: '1px solid rgba(124, 106, 247, 0.3)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 14px',
          marginBottom: '14px',
          fontSize: '14px',
          color: 'var(--accent)',
        }}>
          Найдено объявлений: <strong>{listings.length}</strong>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="loader" />
      ) : error ? (
        <div className="empty-state">
          <div className="icon">❌</div>
          <p>{error}</p>
          <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={fetchListings}>
            Попробовать снова
          </button>
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <div className="icon">😔</div>
          <p>Объявлений не найдено</p>
          {search && (
            <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => setSearch('')}>
              Сбросить поиск
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} onRefresh={fetchListings} />
          ))}
        </div>
      )}
    </div>
  );
}
