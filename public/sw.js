/* Voa Aí · service worker.
   - Guarda só a casca do app (HTML, CSS, JS, ícones). Nada de /api: dado de voo vem sempre do servidor.
   - Push: o servidor manda {titulo, corpo, url}; o toque abre essa url. */
const VERSAO = 'voa-ai-casca-v10';
const CASCA = ['/', '/index.html', '/estilo.css', '/app.js', '/api.js', '/formato.js', '/globo.js', '/aviao3d.js', '/viagens.js', '/manifest.webmanifest',
  '/icones/icone.svg', '/icones/icone-192.png', '/icones/icone-512.png', '/icones/badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro (para pegar versões novas); sem rede, a casca guardada.
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/webhook/')) return;
  const navegacao = r.mode === 'navigate';
  if (!navegacao && !CASCA.includes(url.pathname)) return;
  e.respondWith(fetch(r).then(resp => {
    if (resp.ok && !navegacao) { const copia = resp.clone(); caches.open(VERSAO).then(c => c.put(r, copia)); }
    return resp;
  }).catch(() => caches.match(navegacao ? '/index.html' : r).then(c => c || caches.match('/'))));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data?.text() }; }
  const titulo = d.titulo || 'Voa Aí';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || '',
    icon: '/icones/icone-192.png',
    badge: '/icones/badge-96.png',
    data: { url: d.url || '/' },
    tag: d.url || undefined,
    renotify: !!d.url,
    lang: 'pt-BR',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const j of janelas) {
      if (new URL(j.url).origin === location.origin && 'focus' in j) {
        await j.focus();
        if ('navigate' in j) { try { await j.navigate(alvo); } catch {} }
        return;
      }
    }
    await self.clients.openWindow(alvo);
  })());
});
