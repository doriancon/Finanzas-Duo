self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { return; }
  if (!message || message.type !== 'duo-personal-expense' || typeof message.id !== 'string') return;
  event.waitUntil(self.registration.showNotification('Duo Finance', {
    body: String(message.body || 'Se registró un gasto personal.'),
    icon: '/dyd-192.png',
    badge: '/favicon-48.png',
    tag: `duo-expense-${message.id}`,
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
