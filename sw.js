"use strict";

// Offline-Betrieb: eigene Dateien „Netz zuerst“ (Updates kommen sofort an), Kartenbilder & Schriften „Speicher zuerst“.
// ponytail: ein Cache ohne Aufräumen – alte ?v=-Stände bleiben liegen (wenige KB), CACHE umbenennen + löschen, falls das mal stört.
const CACHE = "pkc-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Beim ersten Besuch liefen Seite, CSS, JS und Kartendaten noch am Service Worker vorbei → gleich sichern.
  // Die Dateiliste kommt aus index.html (relative href/src), damit es keine zweite Liste mit ?v= zu pflegen gibt.
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const res = await fetch("./", { cache: "no-cache" });
      const html = await res.clone().text();
      await cache.put("./", res);
      const files = [...html.matchAll(/(?:href|src)="([^":#]+)"/g)].map((m) => m[1]);
      await cache.addAll([...new Set([...files, "cards.json"])]);
    })
  );
});

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const host = new URL(req.url).hostname;
  if (host === "api.tcgdex.net") return; // Preise haben ihren eigenen 24-h-Speicher in app.js
  const immutable = host === "assets.tcgdex.net" || host === "fonts.gstatic.com";
  e.respondWith(immutable ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Schlechter Empfang (Kartenbörse): nach 3 s die gespeicherte Fassung zeigen statt ewig zu warten.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  net.catch(() => {});
  try {
    const res = await Promise.race([net, new Promise((r) => setTimeout(r, 3000))]);
    if (res) return res;
  } catch {
    /* offline → Speicher */
  }
  return (await cache.match(req)) || (req.mode === "navigate" && (await cache.match("./"))) || net;
}
