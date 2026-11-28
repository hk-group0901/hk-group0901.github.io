/* 辛麺屋 物語 給与アプリ Service Worker
   - 静的ファイルのキャッシュ（オフラインでも画面が開けるように）
*/
const CACHE_NAME = "hk-payroll-v10";
const STATIC_FILES = [
  "./?v=10",
  "./index.html?v=10",
  "./styles.css?v=10",
  "./app.js?v=10",
  "./config.js?v=10",
  "./manifest.json?v=10",
  "./icons/icon-192.png?v=10",
  "./icons/icon-512.png?v=10"
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
    caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request))
  );
});
