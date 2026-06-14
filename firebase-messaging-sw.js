/* Service Worker: фоновые push-уведомления (FCM) + офлайн-кеш оболочки.
   Размещается в КОРНЕ сайта рядом с admin.html. */

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCDMKmjn4BogKl6oswAdD7eaDTbBZRnJqk",
  authDomain: "yana-fitness-booking.firebaseapp.com",
  projectId: "yana-fitness-booking",
  storageBucket: "yana-fitness-booking.firebasestorage.app",
  messagingSenderId: "940148052282",
  appId: "1:940148052282:web:c4d82a89e757e2301e4003"
});

/* ── Фоновые push от FCM (когда вкладка/приложение закрыты) ── */
try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const n = payload.notification || {};
    const data = payload.data || {};
    self.registration.showNotification(n.title || 'Новая заявка', {
      body: n.body || data.body || 'Открой админку, чтобы посмотреть',
      icon: './icon/logo.png',
      badge: './icon/logo.png',
      tag: 'booking',
      renotify: true,
      data: { url: './' }
    });
  });
} catch (e) { /* messaging недоступен — это нормально */ }

/* Клик по уведомлению — открыть/сфокусировать админку */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* Получать уведомление и от страницы (бесплатный путь без сервера) */
self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'notify') {
    self.registration.showNotification(d.title || 'Новая заявка', {
      body: d.body || '', tag: 'booking', renotify: true,
      data: { url: './' }
    });
  }
});

/* ── Минимальный офлайн-кеш оболочки ── */
const CACHE = 'yana-admin-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(hit => {
        const net = fetch(req).then(res => {
          if (res && res.status === 200 && (req.url.startsWith(self.location.origin) || req.url.includes('gstatic') || req.url.includes('googleapis'))) {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    )
  );
});
