import { defineConfig } from "vitest/config";
const basePath = process.env.VITE_BASE_PATH || "/";
const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
const assetPath = (path: string) => `${normalizedBase}${path.replace(/^\/+/, "")}`;

export default defineConfig({
  base: normalizedBase,
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
          normalizedBase,
          assetPath("index.html"),
          assetPath("icon.svg"),
          assetPath("icon-192.png"),
          assetPath("icon-512.png"),
          assetPath("manifest.webmanifest"),
          ...Object.keys(bundle)
            .filter((name) => !name.endsWith(".map"))
            .map(assetPath),
        ];
        const revision = `${normalizedBase}|${Object.keys(bundle).join("|")}`
          .split("")
          .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0)
          .toString(16);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const CACHE='labu-city-${revision}';const BASE=${JSON.stringify(normalizedBase)};const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('labu-city-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match(BASE+'index.html')));return;}if(ASSETS.includes(new URL(e.request.url).pathname))e.respondWith(caches.match(new URL(e.request.url).pathname,{ignoreVary:true}).then(hit=>hit||fetch(e.request)));});`,
        });
      },
    },
  ],
});
