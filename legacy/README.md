# legacy/ —— 已废弃的前端

`vue-frontend/` 是 pyfa-web 最早的 Vue 3 + Vite 界面（`web/static` 里那版
`index-*.js` 就是它的产物），提交 `711bca76` 之后被 `web/frontend/`（React +
Vite，合并 eveship.fit 界面）取代，线上与 `web/static` 都已换成 React 版本。

保留原因：`web/docs/web.md` 与 `web/docs/full-port-design.md` 里有一部分界面说明
（ECharts 图表面板、导入导出对话框等）仍然指向这些 `.vue` 文件；React 版尚未实现
图表面板。

**它不参与构建、不参与部署、也不被任何 Python 代码引用**：

- `Dockerfile` 与 `deploy/auto-update.sh` 都不碰它；
- `.dockerignore` 已排除 `legacy/`；
- vite 的 `outDir` 是 `../static`（即 `web/static`），从 `vue-frontend/` 里跑
  `npm run build` 只会覆盖掉线上产物，**不要在这里构建**。

确认无用后可以整目录删除（`git rm -r legacy`），历史仍留在 git 里。
