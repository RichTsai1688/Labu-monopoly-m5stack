import { defineConfig } from "vitest/config";
export default defineConfig({
  server: {
    proxy: { "/api/npc": "http://127.0.0.1:5175" },
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { deny: ["**/.env*", "**/*.{crt,pem}", "**/.git/**", "**/tools/**"] },
  },
  preview: { proxy: { "/api/npc": "http://127.0.0.1:5175" } },
  optimizeDeps: { entries: ["index.html"] },
  resolve: { dedupe: ["three"] },
  build: {
    target: "es2022",
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
  },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node",
  },
  plugins: [
    {
      name: "offline-game-cache",
      generateBundle(_, bundle) {
        const assets = [
          "/",
          "/index.html",
          "/icon.svg",
          "/icon-192.png",
          "/icon-512.png",
          "/manifest.webmanifest",
          ...Object.keys(bundle)
            .filter((name) => !name.endsWith(".map"))
            .map((name) => "/" + name),
        ];
        const revision = Object.keys(bundle)
          .join("|")
          .split("")
          .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0)
          .toString(16);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const CACHE='labu-city-${revision}';const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('labu-city-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}if(ASSETS.includes(new URL(e.request.url).pathname))e.respondWith(caches.match(new URL(e.request.url).pathname,{ignoreVary:true}).then(hit=>hit||fetch(e.request)));});`,
        });
      },
    },
  ],
});
