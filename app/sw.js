// Service worker: permite instalar o app e abri-lo sem internet.
// Estratégia "rede primeiro": com internet, sempre pega a versão mais nova.
const CACHE = "feed-__VERSAO__"; // trocado a cada publicação
const BASICO = ["./", "index.html", "estilo.css", "app.js", "config.js", "manifest.webmanifest", "icons/lampada-192.png", "icons/icone.svg"];
const EXTERNOS = ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICO).then(() => c.addAll(EXTERNOS).catch(() => {}))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const mesmaOrigem = url.origin === self.location.origin;
  const biblioteca = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname); // bibliotecas e fontes
  if (!mesmaOrigem && !biblioteca) return; // dados (Supabase) nunca vão para este cache
  e.respondWith(
    // "no-cache": confere (pedido novo pela URL, porque navegações não aceitam opções extras) com o servidor em vez de usar a cópia de até 10 min do cache HTTP do GitHub Pages
    fetch(mesmaOrigem ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" }) : e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});

// Notificações das edições (enviadas pelo job às 6h e às 17h)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Feed Inteligente", {
    body: d.body || "Nova edição disponível",
    icon: "icons/lampada-192.png",
    badge: "icons/lampada-192.png",
    tag: "edicao",
    renotify: true,
    data: { url: d.url || "./#hoje" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || "./#hoje", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((abertas) => {
    const app = abertas.find((c) => c.url.startsWith(self.registration.scope));
    if (app) { app.navigate(alvo).catch(() => {}); return app.focus(); }
    return clients.openWindow(alvo);
  }));
});
