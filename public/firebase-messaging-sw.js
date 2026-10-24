self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    return existing ? existing.focus().then(client => client.navigate(target)) : self.clients.openWindow(target);
  }));
});

importScripts('https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
const config = JSON.parse(params.get('config') || '{}');
firebase.initializeApp(config);
firebase.messaging().onBackgroundMessage(payload => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'New reply from 12toons', {
    body: data.body || 'Open your support chat to read the reply.',
    tag: 'support-reply',
    data: { url: data.url || '/#/' },
  });
});
