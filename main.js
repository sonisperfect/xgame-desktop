// XGAME 데스크톱 — 플랫폼 앱 하나에 모든 게임. 2026-11-26
// - 런처 창: 게임 목록(catalog.json + 서버 /api/platforms), 받기·업데이트·지우기·실행, xgame.ai 로그인
// - '3D 게임'(Unity WebGL 묶음)은 사이트의 설치 계층과 같은 manifest.json 으로 받아 userData/games/<게임>/ 에 두고,
//   앱 안의 로컬 서버(127.0.0.1)로 오프라인 실행한다. 웹 게임·아케이드는 xgame.ai 를 같은 로그인 세션으로 연다.
// - 게임 창에는 window.AL_CFG / XG_CFG 로 토큰·서버 주소·로그인 열기를 준다 (AFTERLIGHT 데스크톱과 같은 방식).
"use strict";
const {app, BrowserWindow, ipcMain, shell, session, Menu, dialog} = require("electron");
const http = require("http"), https = require("https"), fs = require("fs"), path = require("path");

const XGAME = process.env.XG_XGAME || "https://xgame.ai";
const RT_AFTERLIGHT = process.env.XG_RT || "wss://xgame.ai/rt/afterlight/ws";
const PORT_BASE = 39710, PART = "persist:xgame";
const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, "catalog.json"), "utf8"));
const GAMES_DIR = () => path.join(app.getPath("userData"), "games");
const STORE = () => path.join(app.getPath("userData"), "session.json");
let token = null, port = 0, launcher = null, loginWin = null;
const gameWins = new Map(), busy = new Map();

// ---------- 로그인 토큰
function loadToken() { try { token = JSON.parse(fs.readFileSync(STORE(), "utf8")).token || null; } catch (e) { token = null; } }
function saveToken(t) { token = t || null; try { fs.mkdirSync(app.getPath("userData"), {recursive: true}); fs.writeFileSync(STORE(), JSON.stringify({token, at: Date.now()})); } catch (e) { /* 세션만 유지 */ } }
function broadcastToken() { for (const w of [launcher, ...gameWins.values()]) if (w && !w.isDestroyed()) w.webContents.send("xg:token", token); }

// ---------- 내려받기: Node https 로 날것 그대로 (.br 을 풀지 않고 저장 — 로컬 서버가 Content-Encoding: br 로 낸다)
function getRaw(url, redirects = 3) {
  return new Promise((ok, no) => {
    const req = https.get(url, {headers: {"User-Agent": `XGAME-Desktop/${app.getVersion()}`, "Accept-Encoding": "identity"}}, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) { res.resume(); getRaw(new URL(res.headers.location, url).href, redirects - 1).then(ok, no); return; }
      if (res.statusCode !== 200) { res.resume(); no(new Error(`${res.statusCode} ${url}`)); return; }
      const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => ok(Buffer.concat(chunks))); res.on("error", no);
    });
    req.setTimeout(60000, () => req.destroy(new Error("timeout " + url)));
    req.on("error", no);
  });
}
const getJson = async url => JSON.parse((await getRaw(url)).toString("utf8"));

// ---------- 목록: 기본 목록 + 서버 표(크기·판·사용 가능) + 설치 상태
const gameDir = g => path.join(GAMES_DIR(), g);
function installedInfo(g) { try { return JSON.parse(fs.readFileSync(path.join(gameDir(g), "installed.json"), "utf8")); } catch (e) { return null; } }
let remote = {at: 0, plat: null, man: {}};
async function refreshRemote(force) {
  if (!force && remote.plat && Date.now() - remote.at < 120000) return remote;
  const next = {at: Date.now(), plat: null, man: {}};
  try { next.plat = (await getJson(XGAME + "/api/platforms")).games || {}; } catch (e) { next.plat = remote.plat; }   // 표가 없어도(오프라인·옛 서버) 목록은 그린다
  await Promise.all(CATALOG.games.filter(c => c.pkg).map(async c => {
    try { const m = await getJson(XGAME + c.pkg + "manifest.json"); next.man[c.id] = {ver: m.version, size: m.total, files: m.files.length}; } catch (e) { if (remote.man[c.id]) next.man[c.id] = remote.man[c.id]; }
  }));
  remote = next;
  cacheImages();   // 기다리지 않는다 — 다음 목록 갱신 때 로컬 그림으로 바뀐다
  return remote;
}
// 게임 그림을 userData/img/<게임>.webp 에 저장 → 오프라인에서도 목록이 그려진다 (/img/<게임> 로 낸다)
const IMG_DIR = () => path.join(app.getPath("userData"), "img");
const imgFile = g => path.join(IMG_DIR(), g + ".webp");
let imgBusy = false;
async function cacheImages() {
  if (imgBusy) return; imgBusy = true;
  try {
    fs.mkdirSync(IMG_DIR(), {recursive: true});
    for (const c of CATALOG.games) {
      if (fs.existsSync(imgFile(c.id))) continue;
      try { const buf = await getRaw(XGAME + c.img); if (buf.length > 1000) fs.writeFileSync(imgFile(c.id), buf); } catch (e) { /* 아직 없는 그림 */ }
    }
  } finally { imgBusy = false; }
}
async function catalogState(force) {
  const r = await refreshRemote(force);
  return {
    xgame: XGAME, version: app.getVersion(), loggedIn: !!token, groups: CATALOG.groups,
    games: CATALOG.games.map(c => {
      const inst = c.pkg ? installedInfo(c.id) : null, man = r.man[c.id], plat = r.plat && r.plat[c.id];
      return {...c, img: fs.existsSync(imgFile(c.id)) ? `http://127.0.0.1:${port}/img/${c.id}` : XGAME + c.img, installed: inst ? {ver: inst.ver, size: inst.size} : null,
        remoteVer: man ? man.ver : null, size: man ? man.size : (plat && plat.size) || 0,
        available: c.pkg ? !!man || !!inst : true, update: !!(inst && man && man.ver !== inst.ver), busy: busy.get(c.id) || null};
    }),
  };
}
function notify(g) { if (launcher && !launcher.isDestroyed()) launcher.webContents.send("xg:progress", {id: g, ...(busy.get(g) || {done: true})}); }

// ---------- 받기·업데이트: manifest 의 파일 + index.html. 같은 이름·크기 파일은 지난 판에서 그대로 옮긴다
async function install(g) {
  const c = CATALOG.games.find(x => x.id === g && x.pkg); if (!c) throw new Error("unknown game");
  if (busy.get(g)) return;
  busy.set(g, {phase: "start", done: 0, total: 1}); notify(g);
  const dst = gameDir(g), tmp = dst + ".part", old = installedInfo(g);
  try {
    const m = await getJson(XGAME + c.pkg + "manifest.json");
    fs.rmSync(tmp, {recursive: true, force: true}); fs.mkdirSync(tmp, {recursive: true});
    const files = [...m.files, {p: "index.html", s: 0}], total = m.total || 1; let done = 0;
    const st = {phase: "download", done: 0, total}; busy.set(g, st); notify(g);
    const queue = files.slice();
    async function worker() {
      for (let f; (f = queue.shift());) {
        const out = path.join(tmp, f.p); fs.mkdirSync(path.dirname(out), {recursive: true});
        const prev = path.join(dst, f.p);
        if (old && f.s && fs.existsSync(prev) && fs.statSync(prev).size === f.s && f.p.startsWith("Build/")) fs.copyFileSync(prev, out);   // 해시 이름이라 같은 파일
        else {
          const buf = await getRaw(XGAME + c.pkg + (f.p === "index.html" ? "" : f.p.split("/").map(encodeURIComponent).join("/")));   // 페이지는 게임 주소 자체
          if (f.s && buf.length !== f.s) throw new Error(`size mismatch ${f.p} ${buf.length}/${f.s}`);
          fs.writeFileSync(out, buf);
        }
        done += f.s || 0; st.done = Math.min(done, total);
        if (!worker._t || Date.now() - worker._t > 150) { worker._t = Date.now(); notify(g); }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    fs.writeFileSync(path.join(tmp, "installed.json"), JSON.stringify({ver: m.version, size: m.total, at: Date.now()}));
    fs.rmSync(dst, {recursive: true, force: true}); fs.renameSync(tmp, dst);
    busy.delete(g); notify(g);
  } catch (e) {
    fs.rmSync(tmp, {recursive: true, force: true}); busy.delete(g);
    if (launcher && !launcher.isDestroyed()) launcher.webContents.send("xg:progress", {id: g, error: String(e.message || e)});
    throw e;
  }
}
function remove(g) { const w = gameWins.get(g); if (w && !w.isDestroyed()) w.close(); fs.rmSync(gameDir(g), {recursive: true, force: true}); notify(g); }

// ---------- 로컬 서버: /g/<게임>/… → userData/games/<게임>/…  (127.0.0.1 만)
const MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript", ".json": "application/json", ".wasm": "application/wasm", ".data": "application/octet-stream",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".css": "text/css",
  ".ico": "image/x-icon", ".txt": "text/plain", ".svg": "image/svg+xml", ".unityweb": "application/octet-stream"};
function serve(req, res) {
  const im = /^\/img\/([a-z0-9-]+)$/.exec((req.url || "").split("?")[0]);
  if (im && fs.existsSync(imgFile(im[1]))) { res.writeHead(200, {"Content-Type": "image/webp", "Cache-Control": "max-age=3600"}); fs.createReadStream(imgFile(im[1])).pipe(res); return; }
  const m = /^\/g\/([a-z0-9-]+)\/(.*)$/.exec(decodeURIComponent((req.url || "/").split("?")[0]));
  if (!m) { res.writeHead(404); res.end(); return; }
  const base = gameDir(m[1]), file = path.normalize(path.join(base, m[2] || "index.html"));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  let ext = path.extname(file), enc = null;
  if (ext === ".br") { enc = "br"; ext = path.extname(file.slice(0, -3)); } else if (ext === ".gz") { enc = "gzip"; ext = path.extname(file.slice(0, -3)); }
  const size = fs.statSync(file).size, h = {"Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"};
  if (enc) h["Content-Encoding"] = enc;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");   // 영상(StreamingAssets/*.mp4)은 범위 요청
  if (range && !enc) {
    const a = +range[1], b = range[2] ? Math.min(+range[2], size - 1) : size - 1;
    res.writeHead(206, {...h, "Content-Range": `bytes ${a}-${b}/${size}`, "Content-Length": b - a + 1, "Accept-Ranges": "bytes"});
    if (req.method === "HEAD") { res.end(); return; } fs.createReadStream(file, {start: a, end: b}).pipe(res); return;
  }
  res.writeHead(200, {...h, "Content-Length": size, "Accept-Ranges": "bytes"});
  if (req.method === "HEAD") { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}
function listen(p) { return new Promise((ok, no) => { const s = http.createServer(serve); s.once("error", no); s.listen(p, "127.0.0.1", () => ok(s)); }); }
async function startServer() { for (let i = 0; i < 30; i++) { try { await listen(PORT_BASE + i); port = PORT_BASE + i; return; } catch (e) { /* 다음 포트 */ } } throw new Error("로컬 포트를 열 수 없습니다"); }

// ---------- 게임 창
function play(g) {
  const c = CATALOG.games.find(x => x.id === g); if (!c) return;
  const open = gameWins.get(g); if (open && !open.isDestroyed()) { open.focus(); return; }
  const local = c.pkg && installedInfo(g);
  if (c.pkg && !local) throw new Error("not installed");
  const w = new BrowserWindow({width: 1600, height: 900, useContentSize: true, minWidth: 960, minHeight: 540, backgroundColor: "#05070d", title: c.name, show: false, autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
      partition: local ? undefined : PART, additionalArguments: ["--xg-game=" + g]}});
  w.once("ready-to-show", () => w.show());
  w.webContents.setWindowOpenHandler(({url}) => {
    if (/\/app(\/|$|\?|#)/.test(url) && /127\.0\.0\.1|xgame\.ai/.test(url) && !/#\/(m|u)\//.test(url)) { openLogin(); return {action: "deny"}; }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return {action: "deny"};
  });
  w.on("closed", () => gameWins.delete(g));
  gameWins.set(g, w);
  w.loadURL(local ? `http://127.0.0.1:${port}/g/${g}/index.html` : XGAME + c.web);
}

// ---------- 로그인 창: xgame.ai/app 을 같은 세션(persist:xgame)으로 열고 xg_token 을 받는다 → 웹 게임도 같은 로그인
function openLogin() {
  if (loginWin) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({width: 520, height: 760, parent: launcher || undefined, title: "xgame.ai", backgroundColor: "#0b0d14", autoHideMenuBar: true,
    webPreferences: {contextIsolation: true, nodeIntegration: false, partition: PART}});
  loginWin.loadURL(XGAME + "/app?from=desktop");
  const timer = setInterval(async () => {
    if (!loginWin || loginWin.isDestroyed()) { clearInterval(timer); return; }
    try {
      const t = await loginWin.webContents.executeJavaScript('(function(){try{return localStorage.getItem("xg_token")}catch(e){return null}})()', true);
      if (t && t !== token) { saveToken(t); clearInterval(timer); broadcastToken(); setTimeout(() => { if (loginWin && !loginWin.isDestroyed()) loginWin.close(); }, 400); }
    } catch (e) { /* 이동 중 */ }
  }, 1000);
  loginWin.on("closed", () => { clearInterval(timer); loginWin = null; });
}
function logout() { saveToken(null); try { session.fromPartition(PART).clearStorageData(); } catch (e) { /* 무시 */ } broadcastToken(); }

// ---------- IPC
ipcMain.handle("xg:catalog", (ev, force) => catalogState(!!force));
ipcMain.handle("xg:install", async (ev, g) => { await install(g); return catalogState(false); });
ipcMain.handle("xg:remove", (ev, g) => { remove(g); return catalogState(false); });
ipcMain.handle("xg:play", (ev, g) => { play(g); return true; });
ipcMain.handle("xg:open", (ev, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
ipcMain.on("xg:login", () => openLogin());
ipcMain.on("xg:logout", () => logout());
ipcMain.on("al:cfg", ev => { ev.returnValue = {tok: token, rt: RT_AFTERLIGHT, xgame: XGAME, version: app.getVersion()}; });
ipcMain.on("al:login", () => openLogin());
ipcMain.on("al:logout", () => logout());
ipcMain.on("al:fullscreen", (ev, on) => { const w = BrowserWindow.fromWebContents(ev.sender); if (w) w.setFullScreen(on == null ? !w.isFullScreen() : !!on); });

// ---------- 런처
function createLauncher() {
  launcher = new BrowserWindow({width: 1280, height: 820, minWidth: 900, minHeight: 600, backgroundColor: "#07080c", title: "XGAME", show: false, autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, "launcher-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  launcher.once("ready-to-show", () => launcher.show());
  launcher.webContents.setWindowOpenHandler(({url}) => { if (/^https:/.test(url)) shell.openExternal(url); return {action: "deny"}; });
  launcher.on("closed", () => { launcher = null; });
  launcher.loadFile(path.join(__dirname, "launcher", "index.html"));
}

if (process.env.XG_USERDATA) app.setPath("userData", process.env.XG_USERDATA);   // 시험용 별도 저장소
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.whenReady().then(async () => {
  loadToken(); if (process.env.XG_TOK) token = process.env.XG_TOK;
  const tpl = [{label: "XGAME", submenu: [{label: "로그인 / Sign in", click: openLogin}, {label: "로그아웃 / Sign out", click: logout}, {type: "separator"},
    {label: "게임 폴더 열기 / Open games folder", click: () => { fs.mkdirSync(GAMES_DIR(), {recursive: true}); shell.openPath(GAMES_DIR()); }}, {type: "separator"}, {role: "quit"}]},
    {label: "View", submenu: [{role: "reload"}, {role: "toggleDevTools"}, {type: "separator"}, {role: "togglefullscreen"}]}];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
  try { await startServer(); } catch (e) { dialog.showErrorBox("XGAME", String(e)); app.quit(); return; }
  createLauncher();
  if (process.env.XG_AUTOPLAY) { try { if (process.env.XG_INSTALL) await install(process.env.XG_AUTOPLAY); play(process.env.XG_AUTOPLAY); } catch (e) { console.error("[xg] autoplay", e); } }
  app.on("activate", () => { if (!launcher) createLauncher(); });
});
app.on("window-all-closed", () => app.quit());
