import axios from 'axios';
import { useTelegram } from './useTelegram';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Хук для запросов к нашему API
export function useApi() {
  const { initData } = useTelegram();

  const api = axios.create({
    baseURL: BASE_URL,
    timeout: 8000,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData,
    },
  });

  return {
    // Объявления
    getListings: (params) => api.get('/listings', { params }),
    getListing: (id) => api.get(`/listings/${id}`),
    createListing: (data) => api.post('/listings', data),
    deleteListing: (id) => api.delete(`/listings/${id}`),

    // Пользователь
    register: () => api.post('/users/register'),
    getMe: () => api.get('/users/me'),

    // Платежи
    buyListing: (listingId) => api.post(`/payments/buy/${listingId}`),
    getTransactionStatus: (txId) => api.get(`/payments/status/${txId}`),
  };
}
