// 게임 창: window.AL_CFG(AFTERLIGHT 와 같은 모양) + window.XG_CFG — 토큰·서버 주소·로그인 열기·전체 화면
const {contextBridge, ipcRenderer} = require("electron");
let cfg = ipcRenderer.sendSync("al:cfg");
ipcRenderer.on("xg:token", (ev, t) => { cfg = Object.assign({}, cfg, {tok: t}); });
const arg = (process.argv || []).find(a => a.startsWith("--xg-game="));
const api = {
  tok: () => (cfg && cfg.tok) || null,
  rt: cfg.rt, xgame: cfg.xgame, version: cfg.version, desktop: true, platform: "xgame-desktop", game: arg ? arg.slice(10) : null,
  login: () => ipcRenderer.send("al:login"),
  logout: () => ipcRenderer.send("al:logout"),
  fullscreen: on => ipcRenderer.send("al:fullscreen", on),
};
contextBridge.exposeInMainWorld("AL_CFG", api);
contextBridge.exposeInMainWorld("XG_CFG", api);
