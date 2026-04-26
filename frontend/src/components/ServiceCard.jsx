import { useState } from 'react';
import { useTelegram } from '../hooks/useTelegram';

export const CATEGORY_LABELS = {
  design:      '🎨 Дизайн',
  dev:         '💻 Разработка',
  copywriting: '✍️ Копирайтинг',
  marketing:   '📢 Маркетинг',
  translation: '🌐 Переводы',
  video:       '🎬 Видео',
  other:       '📦 Другое',
};

export default function ServiceCard({ service, isOwner = false, onDelete, onOrder }) {
  const [loading, setLoading] = useState(false);
  const { haptic } = useTelegram();

  const handleOrder = () => {
    haptic('medium');
    if (onOrder) onOrder(service);
  };

  const handleDelete = async () => {
    haptic('medium');
    setLoading(true);
    try { if (onDelete) await onDelete(service.id); }
    finally { setLoading(false); }
  };

  return (
    <div className="card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: '11px', background: 'var(--accent-light)', color: 'var(--accent)',
            padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap',
          }}>
            {CATEGORY_LABELS[service.category] || service.category}
          </span>
          <h3 style={{
            fontSize: '15px', fontWeight: 700, marginTop: '6px', lineHeight: 1.35,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {service.title}
          </h3>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '17px', color: 'var(--accent)' }}>
            {service.price} {service.currency}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            ⏱ {service.delivery_days} дн.
          </div>
        </div>
      </div>

      {service.description && (
        <p style={{
          fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {service.description}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          👤 {service.seller_name}
          {service.seller_username && (
            <span style={{ color: 'var(--accent)' }}> @{service.seller_username}</span>
          )}
        </span>
        {service.rating ? (
          <span style={{ color: '#f5c842' }}>
            ★ {service.rating} <span style={{ color: 'var(--text-secondary)' }}>({service.reviews_count})</span>
          </span>
        ) : (
          <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Нет отзывов</span>
        )}
      </div>

      {!isOwner && (
        <button className="btn btn-primary btn-full" onClick={handleOrder} disabled={loading}>
          Заказать — {service.price} {service.currency}
        </button>
      )}

      {isOwner && (
        <button className="btn btn-danger btn-full" onClick={handleDelete} disabled={loading}>
          {loading ? '⏳ Удаление...' : '🗑 Удалить услугу'}
        </button>
      )}
    </div>
  );
}
