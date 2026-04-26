import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useTelegram } from './hooks/useTelegram';
import { useApi } from './hooks/useApi';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import CreateService from './pages/CreateService';
import MyOrders from './pages/MyOrders';
import Profile from './pages/Profile';

export default function App() {
  const { tg, expand } = useTelegram();
  const { register } = useApi();

  useEffect(() => {
    if (tg) { tg.ready(); expand(); }
    register().catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"           element={<Home />} />
        <Route path="/create"     element={<CreateService />} />
        <Route path="/my-orders"  element={<MyOrders />} />
        <Route path="/profile"    element={<Profile />} />
      </Routes>
      <Navbar />
    </BrowserRouter>
  );
}
