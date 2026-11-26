// 런처 창에 내보내는 것: 목록·받기·지우기·실행·로그인. 그 밖의 Node/Electron 은 없다
const {contextBridge, ipcRenderer} = require("electron");
contextBridge.exposeInMainWorld("XG", {
  catalog: force => ipcRenderer.invoke("xg:catalog", force),
  install: id => ipcRenderer.invoke("xg:install", id),
  remove: id => ipcRenderer.invoke("xg:remove", id),
  play: id => ipcRenderer.invoke("xg:play", id),
  saveWeb: id => ipcRenderer.invoke("xg:saveweb", id),
  unsaveWeb: id => ipcRenderer.invoke("xg:unsaveweb", id),
  open: url => ipcRenderer.invoke("xg:open", url),
  login: () => ipcRenderer.send("xg:login"),
  logout: () => ipcRenderer.send("xg:logout"),
  onProgress: fn => ipcRenderer.on("xg:progress", (ev, p) => fn(p)),
  onToken: fn => ipcRenderer.on("xg:token", (ev, t) => fn(!!t)),
});
