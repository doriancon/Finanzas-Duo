self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { return; }
  if (!message || !['duo-personal-expense', 'duo-fund-reminder'].includes(message.type) || typeof message.id !== 'string') return;
  const reminder = message.type === 'duo-fund-reminder';
  event.waitUntil(self.registration.showNotification(reminder ? 'Duo Finance 💜' : 'Duo Finance', {
    body: String(message.body || (reminder ? 'Hoy tenés un aporte programado.' : 'Se registró un gasto personal.')),
    icon: '/dyd-192.png',
    badge: '/favicon-48.png',
    tag: `${reminder ? 'duo-fund' : 'duo-expense'}-${message.id}`,
    renotify: false,
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    return self.clients.openWindow('/');
  })());
});
