import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// The backend runs on 8100 (see pyfa-web/web.yml). In dev, the React app is served
// by vite on 5173 and proxies every /api and /img request to the backend, sharing
// the session cookie with it (same origin is not required in dev because the proxy
// forwards cookies).
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          // EVEShipFit/images: the item icons, one WebP per image, served from /images/
          src: "node_modules/@eveshipfit/images/dist/images/*",
          dest: "images",
        },
      ],
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8100", changeOrigin: true },
      "/img": { target: "http://127.0.0.1:8100", changeOrigin: true },
    },
  },
  // The production build lands in web/static, which the FastAPI app already serves
  // with a SPA fallback (see web/main.py). The previous Vue build is replaced.
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
});
