import React from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles/app.css"

const container = document.getElementById("root")
if (!container) throw new Error("missing #root element")

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// 维护页兜底：后端重启时 nginx 会直接回 502/504，浏览器拿不到前端，只有已经装过
// Service Worker 的浏览器能靠缓存里的 maintenance.html 顶上（见 public/sw.js）。
// 生产构建才注册；开发时注册会干扰 Vite 的 HMR。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined)
  })
}
