// Хук для работы с Telegram WebApp API
export function useTelegram() {
  const tg = window.Telegram?.WebApp;

  return {
    tg,
    // Данные пользователя из Telegram
    user: tg?.initDataUnsafe?.user || null,
    // Строка initData для авторизации на сервере
    initData: tg?.initData || '',
    // Цветовая схема (light / dark)
    colorScheme: tg?.colorScheme || 'dark',
    // Показать/скрыть кнопку "Назад"
    showBackButton: () => tg?.BackButton?.show(),
    hideBackButton: () => tg?.BackButton?.hide(),
    // Закрыть мини-апп
    close: () => tg?.close(),
    // Расширить на весь экран
    expand: () => tg?.expand(),
    // Показать уведомление
    showAlert: (msg) => tg?.showAlert(msg),
    // Показать подтверждение
    showConfirm: (msg, cb) => tg?.showConfirm(msg, cb),
    // Вибрация
    haptic: (type = 'light') => tg?.HapticFeedback?.impactOccurred(type),
  };
}
