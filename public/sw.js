/* Offline shell for the installed app.
 *
 * The point of this on a phone is not really offline play — it is that an
 * installed game must not show a browser error page when the tunnel eats the
 * signal for four seconds. So: serve from cache first for anything immutable,
 * and never let a navigation fail.
 *
 * Two rules do the work:
 *
 *  - Hashed build assets (`/assets/index-a1b2c3d4.js`) and generated art are
 *    content-addressed and can be cached forever. Cache-first, no revalidation.
 *  - The navigation request is the one that must never fail. Network-first so a
 *    deploy is picked up promptly, falling back to the cached shell.
 *
 * The cache name carries a version. Bump it and every old cache is dropped on
 * activate, which is the whole upgrade story — there is no partial migration
 * because there is no state in here worth migrating.
 */
const VERSION = 'caerwen-v1';
const SHELL = './index.html';

self.addEventListener('install', (e) => {
  // Only the shell is precached. Precaching the whole game would mean a
  // multi-megabyte download before the first frame, on a connection we know
  // nothing about; everything else arrives through the runtime cache as it is
  // actually used.
  e.waitUntil(
    caches.open(VERSION).then((c) => c.add(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Content-addressed, or art that only changes when its name does. */
function immutable(url) {
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g)$/.test(url.pathname)
    || /\/(art|fonts|icons)\//.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(SHELL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r ?? Response.error())),
    );
    return;
  }

  if (!immutable(url)) return;

  e.respondWith(
    caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      // Opaque and error responses are not worth keeping; a cached 404 is a
      // 404 forever, which is a far worse failure than a re-fetch.
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
