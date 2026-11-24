/* Фокус — service worker
 * Navigations & HTML: network-first with 4s timeout → cache fallback.
 *   (Троттлинг вешает соединение, а не рвёт его — поэтому таймаут,
 *   а не только .catch: приложение открывается даже когда хостинг «лежит».)
 * Static assets: cache-first with background refill.
 */
const CACHE = 'focus-v2'
const NAV_TIMEOUT_MS = 4000
const ASSET_EXT = /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|ico|webmanifest)$/i

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      ctrl.abort()
      reject(new Error('navigation timeout'))
    }, ms)
    fetch(request, { signal: ctrl.signal })
      .then((res) => {
        clearTimeout(timer)
        resolve(res)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Never intercept cross-origin (fonts etc.) — let the browser handle them
  if (url.origin !== self.location.origin) return

  // HTML / navigations: network-first, но не дольше NAV_TIMEOUT_MS
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetchWithTimeout(request, NAV_TIMEOUT_MS)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return res
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match(self.registration.scope)),
        ),
    )
    return
  }

  // Static assets: cache-first, then network and cache
  if (ASSET_EXT.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return res
          }),
      ),
    )
  }
})
