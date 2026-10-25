import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// 生产部署挂在子路径上（nginx strip 前缀，应用侧 PYFA_WEB_ROOT_PATH=/AssemblyPlanning）。
// 这里把 base 设成同一路径，让**构建期**就把三类根相对地址补全：
//   - index.html 里的 /assets/...
//   - import.meta.env.BASE_URL（图标 /images/ui/、物品图 /images/）
//   - api.ts 的 apiUrl()（/api/... 与 /img/...）
// 这样反代就不必再做 sub_filter 改写（改写 JS 字符串既脆又会让 304 缓存失配）。
// 部署在域名根时用 PYFA_BASE=/ 构建。
const base = process.env.PYFA_BASE ?? "/AssemblyPlanning/";

export default defineConfig({
  base,
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
    // 开发时页面在 <base>/ 下，接口仍由后端 :8100 提供；先把 base 前缀去掉再转过去。
    proxy: Object.fromEntries(
      ["api", "img"].flatMap((prefix) => [
        [
          `${base}${prefix}`,
          {
            target: "http://127.0.0.1:8100",
            changeOrigin: true,
            rewrite: (path) => path.replace(base.replace(/\/$/, ""), ""),
          },
        ],
        // 根相对的老路径也照旧可直连，方便手工 curl
        [`/${prefix}`, { target: "http://127.0.0.1:8100", changeOrigin: true }],
      ]),
    ),
  },
  // The production build lands in web/static, which the FastAPI app already serves
  // with a SPA fallback (see web/main.py). The previous Vue build is replaced.
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
});
