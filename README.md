# XGAME 데스크톱

모든 XGAME 게임을 한 앱에서. 2026-11-26 시작.

**받기**: [최신 릴리스](https://github.com/sonisperfect/xgame-desktop/releases/latest) · 소개 영상: [XGAME-promo.mp4](https://github.com/sonisperfect/xgame-desktop/releases/download/v0.1.1/XGAME-promo.mp4)

![XGAME](launcher/welcome.webp)

- **런처**: 게임 목록(`catalog.json` + 서버 `/api/platforms`), 받기·업데이트·지우기·실행, xgame.ai 로그인(웹 게임과 같은 세션).
- **3D 게임**: 사이트 설치 계층과 같은 `manifest.json`으로 `userData/games/<게임>/`에 받고, 앱 안 로컬 서버(127.0.0.1)에서 오프라인으로 실행합니다. 같은 이름·크기의 Build 파일은 업데이트 때 다시 받지 않습니다.
- **웹 게임·아케이드**: xgame.ai를 같은 로그인 세션(`persist:xgame`)으로 엽니다.
- 게임 창에는 `window.AL_CFG` / `window.XG_CFG`(토큰·서버 주소·로그인·전체 화면)를 넣습니다. AFTERLIGHT 데스크톱 앱과 같은 방식입니다.

```
npm start                       # 개발 실행 (XG_USERDATA=<폴더> 로 시험 저장소 분리)
npx electron-builder --mac --win  # dist/XGAME-<판>-{mac-arm64,mac-x64}.dmg, -win-x64.exe (서명 없음)
```
시험용 환경 변수: `XG_XGAME`(서버), `XG_TOK`(토큰), `XG_AUTOPLAY=<게임>` + `XG_INSTALL=1`.
