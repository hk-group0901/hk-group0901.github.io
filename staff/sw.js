/* 辛麺屋 物語 スタッフアプリ Service Worker
   - 静的ファイルのキャッシュ（オフラインでも画面が開けるように）
   - Web Push の受信と通知表示
*/
const CACHE_NAME = "karamenya-staff-v3";
const STATIC_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Supabase への通信はキャッシュしない
  if (url.hostname.endsWith("supabase.co")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ---- Web Push ----
self.addEventListener("push", (event) => {
  let data = { title: "辛麺屋 物語", body: "お知らせがあります" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* テキスト形式のペイロードにも対応 */ 
    if (event.data) data.body = event.data.text();
  }
  const options = {
    body: data.body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: data.url || "./index.html#inbox" },
    vibrate: [80, 40, 80]
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes("index.html") && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
