// XGAME 런처 화면 — 목록을 그리고 받기·실행·지우기를 main 에 부탁한다 (window.XG, launcher-preload.js)
"use strict";
const KO = /^ko/i.test(navigator.language || "ko");
const L = (ko, en) => (KO ? ko : en);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const mb = b => (b ? `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB` : "");
let state = null, filter = "all";
const prog = {}, errs = {};

function desc(g) { return KO ? g.ko : g.en || g.ko; }
function status(g) {
  if (prog[g.id]) return {k: "busy"};
  if (g.running) return {k: "running"};
  if (g.nativeOnly && !g.available) return {k: "na"};
  if (!g.pkg && !g.nativeOs) return {k: "web"};
  if (g.installed) return {k: g.update ? "update" : "ready"};
  return {k: g.available ? "get" : "na"};
}
function actions(g) {
  const s = status(g), p = prog[g.id];
  if (s.k === "busy") { const pct = p.total ? Math.floor((100 * p.done) / p.total) : 0;
    if (p.phase === "unpack") return `<div class="busy"><span class="muted">${L("설치하는 중…", "Installing…")}</span><div class="prog"><i data-pct="100"></i></div></div>`;
    return `<div class="busy"><span class="muted">${L("받는 중", "Downloading")} ${pct}%${p.total > 1 ? ` · ${mb(p.done)} / ${mb(p.total)}` : ""}</span><div class="prog"><i data-pct="${pct}"></i></div></div>`; }
  if (s.k === "running") return `<button class="btn" disabled>${L("실행 중", "Running")}</button>`;
  if (s.k === "web") return `<button class="btn gold" data-act="play" data-id="${g.id}">${L("실행", "Play")}</button>` + (g.webSavable
    ? (g.webSaved ? `<button class="btn ghost" data-act="unsaveweb" data-id="${g.id}" title="${esc(L("오프라인 저장 지우기", "Remove offline copy"))}">${L("오프라인 ✓", "Offline ✓")}</button>`
      : `<button class="btn ghost" data-act="saveweb" data-id="${g.id}">${L("오프라인 저장", "Save offline")}</button>`) : "");
  if (s.k === "get") return `<button class="btn gold" data-act="install" data-id="${g.id}">${L("받기", "Get")}${g.size ? " · " + mb(g.size) : ""}</button>`;
  if (s.k === "na") return `<button class="btn" disabled>${L("준비 중", "Coming soon")}</button>`;
  const upd = s.k === "update" ? `<button class="btn" data-act="install" data-id="${g.id}">${L("업데이트", "Update")}</button>` : "";
  return `<button class="btn gold" data-act="play" data-id="${g.id}">${L("실행", "Play")}</button>${upd}<button class="btn ghost" data-act="remove" data-id="${g.id}" aria-label="${esc(L("지우기", "Remove"))} ${esc(g.name)}">${L("지우기", "Remove")}</button>`;
}
function badge(g) {
  const s = status(g);
  if (g.nativeOs) return `<span class="st ok">${s.k === "ready" || s.k === "running" ? L("설치됨 · 고화질", "Installed · HD native") : L("고화질 네이티브", "HD native")}</span>`;
  if (s.k === "ready") return `<span class="st ok">${L("설치됨", "Installed")}</span>`;
  if (s.k === "update") return `<span class="st ok">${L("업데이트 있음", "Update")}</span>`;
  if (s.k === "web") return `<span class="st${g.webSaved ? " ok" : ""}">${g.webSaved ? L("오프라인 가능", "Plays offline") : L("온라인", "Online")}</span>`;
  return "";
}
function card(g) {
  return `<article class="card" id="c-${g.id}"><div class="ban" data-bg="${esc(g.img)}">${badge(g)}</div>
    <div class="body"><div class="name">${esc(g.name)}</div><div class="desc">${esc(desc(g))}</div>
    ${errs[g.id] ? `<div class="err">${esc(errs[g.id])}</div>` : ""}<div class="acts">${actions(g)}</div></div></article>`;
}
function hero(g) {
  const s = status(g);
  const sub = g.pkg ? (g.installed ? L("이 컴퓨터에 설치됨 · 오프라인 실행", "Installed · plays offline") : mb(g.size) ? `${mb(g.size)} · ${L("받으면 오프라인으로 실행", "plays offline once downloaded")}` : "") : L("온라인", "Online");
  return `<div class="in"><span class="muted">${esc(g.tag ? (KO ? g.tag.ko : g.tag.en) : "")}</span><h1>${esc(g.name)}</h1><p>${esc(desc(g))}</p>
    <div class="row">${s.k === "busy" ? `<span class="muted">${L("받는 중", "Downloading")}…</span>` : actions(g).replace(/<button class="btn ghost"[\s\S]*$/, "")}<span class="muted">${esc(sub)}</span></div></div>`;
}
function render() {
  if (!state) return;
  $("#ver").textContent = `XGAME ${state.version}`;
  $("#whoText").textContent = state.loggedIn ? L("로그인됨", "Signed in") : L("로그인하면 기록이 계정에 남아요", "Sign in to keep your records");
  $("#loginBtn").textContent = state.loggedIn ? L("로그아웃", "Sign out") : L("xgame.ai 로그인", "Sign in");
  const list = state.games.filter(g => filter === "all" || g.installed);
  const f = state.games.find(g => g.featured);
  const h = $("#hero"), first = !state.games.some(g => g.installed);
  if (filter === "all" && first && f) {   // 처음 연 사람: 환영 화면 (Higgsfield 대표 그림)
    h.hidden = false; h.style.backgroundImage = "url('welcome.webp')";
    h.innerHTML = `<div class="in"><span class="muted">XGAME</span><h1>${L("모든 게임을<br>한 앱에서", "Every game,<br>one app")}</h1>
      <p>${L("3D 게임은 받아 두면 인터넷 없이 실행되고, 웹 게임과 아케이드는 같은 로그인으로 바로 열립니다.", "3D games play offline once downloaded; web games and the arcade open with the same sign-in.")}</p>
      <div class="row">${prog[f.id] ? `<span class="muted">${L("받는 중", "Downloading")}…</span>` : `<button class="btn gold" data-act="install" data-id="${f.id}">${esc(f.name)} ${L("받기", "— get it")}${f.size ? " · " + mb(f.size) : ""}</button>`}
      <span class="muted">${L("또는 아래에서 골라 보세요", "or pick one below")}</span></div></div>`;
  } else if (f && filter === "all") { h.hidden = false; h.style.backgroundImage = `url('${f.img}')`; h.innerHTML = hero(f); } else h.hidden = true;
  $("#groups").innerHTML = state.groups.map(gr => {
    const gs = list.filter(g => g.group === gr.id); if (!gs.length) return "";
    return `<h2>${esc(KO ? gr.ko : gr.en)}</h2><div class="grid">${gs.map(card).join("")}</div>`;
  }).join("") || `<p class="empty">${L("아직 받은 게임이 없어요. ‘전체’에서 받아 보세요.", "No games yet — get one from 'All'.")}</p>`;
  document.querySelectorAll("[data-bg]").forEach(el => { el.style.backgroundImage = `url("${el.dataset.bg}")`; });   // CSP: 인라인 style 속성 대신 CSSOM
  const anyRemote = state.games.some(g => g.pkg && g.remoteVer);
  const off = $("#offline"); off.hidden = anyRemote; off.textContent = L("서버에 연결하지 못했어요. 받아 둔 게임은 그대로 실행할 수 있어요.", "Can't reach the server. Installed games still play.");
}
async function load(force) { try { state = await XG.catalog(force); } catch (e) { /* 다음에 다시 */ } render(); }

document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.filter) { filter = b.dataset.filter; document.querySelectorAll(".filters button").forEach(x => x.classList.toggle("on", x === b)); render(); return; }
  if (b.id === "loginBtn") { state && state.loggedIn ? XG.logout() : XG.login(); return; }
  const id = b.dataset.id, act = b.dataset.act; if (!id) return;
  delete errs[id];
  if (act === "play") { try { await XG.play(id); } catch (err) { errs[id] = L("실행하지 못했어요", "Couldn't start"); render(); } }
  else if (act === "install") { prog[id] = {done: 0, total: 1}; render(); try { state = await XG.install(id); } catch (err) { errs[id] = L("받지 못했어요 — 다시 눌러 주세요", "Download failed — try again"); } delete prog[id]; render(); }
  else if (act === "remove") { state = await XG.remove(id); render(); }
  else if (act === "saveweb") { prog[id] = {done: 0, total: 1}; render(); try { state = await XG.saveWeb(id); } catch (err) { errs[id] = L("저장하지 못했어요 — 다시 눌러 주세요", "Couldn't save — try again"); } delete prog[id]; render(); }
  else if (act === "unsaveweb") { state = await XG.unsaveWeb(id); render(); }
});
XG.onProgress(p => {
  if (p.error) { errs[p.id] = L("받지 못했어요 — 다시 눌러 주세요", "Download failed — try again"); delete prog[p.id]; render(); return; }
  if (p.done === true) { delete prog[p.id]; load(false); return; }
  prog[p.id] = p;
  const c = document.getElementById("c-" + p.id); const g = state && state.games.find(x => x.id === p.id);
  if (c && g) c.querySelector(".acts").innerHTML = actions(g);   // 카드만 다시
  document.querySelectorAll("[data-pct]").forEach(el => { el.style.width = el.dataset.pct + "%"; });
  if (g && g.featured) $("#hero").innerHTML = hero(g);
});
XG.onToken(on => { if (state) { state.loggedIn = on; render(); } });
load(false);
setInterval(() => load(false), 120000);
