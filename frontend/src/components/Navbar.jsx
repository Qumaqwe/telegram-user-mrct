import { useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  { path: '/', label: 'Маркет', icon: '🏪' },
  { path: '/sell', label: 'Продать', icon: '💰' },
  { path: '/my-listings', label: 'Мои', icon: '📋' },
  { path: '/profile', label: 'Профиль', icon: '👤' },
];

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'rgba(15, 15, 19, 0.95)',
      backdropFilter: 'blur(20px)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      padding: '8px 0 max(8px, env(safe-area-inset-bottom))',
      zIndex: 100,
    }}>
      {tabs.map((tab) => {
        const active = location.pathname === tab.path;
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '3px',
              padding: '6px 4px',
              cursor: 'pointer',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              transition: 'color 0.15s',
            }}
          >
            <span style={{ fontSize: '22px', lineHeight: 1 }}>{tab.icon}</span>
            <span style={{ fontSize: '11px', fontWeight: active ? 600 : 400 }}>
              {tab.label}
            </span>
            {active && (
              <div style={{
                position: 'absolute',
                top: 0,
                width: '30px',
                height: '2px',
                background: 'var(--accent)',
                borderRadius: '0 0 4px 4px',
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}
