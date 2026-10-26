/* pyfa-web 的维护页兜底。
 *
 * 后端重启、更新脚本 rollout、进程被 OOM 杀掉的时候，nginx 连不上上游，自己回一个
 * 502/504 —— 浏览器那时拿不到任何前端代码，前端再怎么写都来不及。所以这里留了一条
 * 离线通道：Service Worker 在安装时把 maintenance.html 存进缓存；之后每次“打开页面”
 * 都照样走网络（绝不缓存应用本身，避免旧 bundle），只有网络失败或者上游回
 * 502/503/504 的时候，才把缓存里的维护页顶上去。
 *
 * 两条底线：
 *   - 只接管导航请求（request.mode === "navigate"），接口、图片、SSE 一概不碰；
 *   - 不缓存 index.html / assets，所以发布新版不会有旧壳子的问题。
 *
 * 改了 maintenance.html 就把 CACHE 的版本号 +1：安装新 SW 时会重新抓一份。
 */

const CACHE = "pyfa-web-maintenance-v1"
const MAINTENANCE = "maintenance.html" // 相对 sw.js 自己所在的目录（子路径部署也对）

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // cache: "reload" 绕过 HTTP 缓存，保证拿到的是当前这版页面
      await cache.add(new Request(MAINTENANCE, { cache: "reload" })).catch(() => undefined)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

/** 上游不可用：502 网关挂、503 维护、504 超时都算。 */
function isUpstreamDown(status) {
  return status === 502 || status === 503 || status === 504
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.mode !== "navigate") return
  // 维护页自己不要经过这里：它可能正在轮询 api/meta，那属于普通请求
  if (new URL(request.url).pathname.endsWith("/maintenance.html")) return

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        if (!isUpstreamDown(response.status)) return response
        const cached = await caches.match(MAINTENANCE)
        return cached ?? maintenanceFallback(response.status)
      } catch {
        const cached = await caches.match(MAINTENANCE)
        return cached ?? maintenanceFallback(503)
      }
    })(),
  )
})

/** 连缓存都没装上（首次访问就赶上重启）时的最后一道：一句纯文本。 */
function maintenanceFallback(status) {
  return new Response("正在维护，马上回来。 Under maintenance — back in a moment.", {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  })
}
