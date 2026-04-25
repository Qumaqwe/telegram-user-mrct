import { useEffect } from 'react';
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

  useEffect(() => {
    // Инициализация Telegram WebApp (ready() уже вызван в index.html, но дублируем для надёжности)
    if (tg) {
      tg.ready();
      expand();
    }

    // Регистрируем пользователя в фоне, не блокируя UI
    register().catch(() => {});
  }, []);

  // Показываем UI сразу — без экрана загрузки
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
