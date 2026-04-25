import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useTelegram } from '../hooks/useTelegram';

export default function ListingCard({ listing, isOwner = false, onDelete, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const { buyListing } = useApi();
  const { user, tg, haptic, showAlert } = useTelegram();

  const handleBuy = async () => {
    haptic('medium');
    setLoading(true);
    try {
      const res = await buyListing(listing.id);
      const { transaction_id, amount } = res.data;

      // Открываем бота с инвойсом
      tg?.openTelegramLink(`https://t.me/${import.meta.env.VITE_BOT_USERNAME}?start=buy_${listing.id}`);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Ошибка при покупке';
      showAlert(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    haptic('medium');
    setLoading(true);
    try {
      await onDelete(listing.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>
              @{listing.username}
            </span>
            <span className={`badge badge-${listing.status}`}>
              {listing.status === 'active' ? '✓ Доступен' : listing.status === 'sold' ? '✗ Продан' : 'Снят'}
            </span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Продаёт: {listing.first_name || listing.seller_username || 'Пользователь'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stars" style={{ fontSize: '20px' }}>
            ⭐ {listing.price.toLocaleString()}
          </div>
        </div>
      </div>

      {listing.description && (
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {listing.description}
        </p>
      )}

      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
        {new Date(listing.created_at).toLocaleDateString('ru-RU', {
          day: 'numeric', month: 'short', year: 'numeric'
        })}
      </div>

      {!isOwner && listing.status === 'active' && (
        <button
          className="btn btn-primary btn-full"
          onClick={handleBuy}
          disabled={loading}
        >
          {loading ? '⏳ Загрузка...' : `🛒 Купить за ${listing.price} ⭐`}
        </button>
      )}

      {isOwner && listing.status === 'active' && (
        <button
          className="btn btn-danger btn-full"
          onClick={handleDelete}
          disabled={loading}
        >
          {loading ? '⏳ Удаление...' : '🗑 Снять с продажи'}
        </button>
      )}
    </div>
  );
}
