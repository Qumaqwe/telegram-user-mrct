import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useTelegram } from './hooks/useTelegram';
import { useApi } from './hooks/useApi';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Sell from './pages/Sell';
import MyListings from './pages/MyListings';
import Profile from './pages/Profile';

export default function App() {
  const { tg, expand } = useTelegram();
  const { register } = useApi();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Инициализация Telegram WebApp
    if (tg) {
      tg.ready();
      expand();
      // Тёмная тема
      document.documentElement.style.setProperty('--bg', tg.themeParams?.bg_color || '#0f0f13');
    }

    // Регистрируем пользователя
    register()
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        minHeight: '100dvh', gap: '16px',
      }}>
        <div style={{ fontSize: '48px' }}>🏪</div>
        <div className="loader" />
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Загрузка маркета...</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sell" element={<Sell />} />
        <Route path="/my-listings" element={<MyListings />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
      <Navbar />
    </BrowserRouter>
  );
}
