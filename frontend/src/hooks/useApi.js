import axios from 'axios';
import { useTelegram } from './useTelegram';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export function useApi() {
  const { initData } = useTelegram();

  const api = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData,
    },
  });

  return {
    // Auth
    register: ()       => api.post('/users/register'),
    getMe:    ()       => api.get('/users/me'),

    // Services
    getServices:   (params) => api.get('/services', { params }),
    getService:    (id)     => api.get(`/services/${id}`),
    createService: (data)   => api.post('/services', data),
    deleteService: (id)     => api.delete(`/services/${id}`),

    // Orders
    createOrder:   (serviceId, data) => api.post(`/orders/create/${serviceId}`, data),
    getMyOrders:   ()                => api.get('/orders/my'),
    getOrder:      (id)              => api.get(`/orders/${id}`),
    checkPayment:  (id)              => api.post(`/orders/${id}/check-payment`),
    confirmOrder:  (id, data)        => api.post(`/orders/${id}/confirm`, data),
    disputeOrder:  (id, data)        => api.post(`/orders/${id}/dispute`, data),
  };
}
