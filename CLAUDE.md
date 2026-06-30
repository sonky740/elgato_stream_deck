# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 저장소 개요

Elgato **Stream Deck +** 용 플러그인 **npm workspaces 모노레포**. 각 플러그인은 루트 하위 디렉토리에 자기완결적으로 들어가고(독립 빌드), **ESLint·Prettier 설정은 루트에서 공용**으로 가져다 쓴다. 첫 플러그인은 [media_controller/](media_controller/) — OS 미디어 세션을 통해 현재 재생 곡을 표시하고 제어한다(YouTube Music 포함, 넓게는 모든 미디어 플레이어). 새 플러그인은 루트에 디렉토리를 만들고 루트 [package.json](package.json)의 `workspaces`에 추가한다.

대상: macOS 12+ / Windows 10+. Stream Deck 앱 **7.1+** 필요(매니페스트 `SDKVersion: 3`, `Nodejs.Version: 24`).

## 명령어

**의존성 설치·lint·format은 루트에서** (npm workspaces — 한 번 설치하면 전 플러그인이 공용 도구를 공유):

```bash
npm install                  # 루트 1회 — 모든 워크스페이스 의존성 + 공용 devtool 설치
npm run lint                 # eslint . (전 워크스페이스)
npm run lint:fix             # eslint . --fix
npm run format               # prettier --write .
npm run format:check         # prettier --check .
npm run build                # 모든 워크스페이스 빌드 (npm run build --workspaces --if-present)
```

플러그인별 빌드/배포·streamdeck 명령은 **플러그인 디렉토리 안에서** (예: `cd media_controller`), 또는 루트에서 `-w media-controller`로:

```bash
npm run build                                 # rollup 빌드 → *.sdPlugin/bin/plugin.js (terser 압축)
npm run watch                                 # 변경 감지 빌드 + 저장 시 자동 streamdeck restart

streamdeck dev                                # 개발자 모드 활성화(서명 안 된 로컬 플러그인 실행 허용) — 최초 1회
streamdeck link com.sonky.media-controller.sdPlugin   # 플러그인을 Stream Deck에 연결 — 최초 1회
streamdeck restart com.sonky.media-controller         # 플러그인 재시작(코드 변경 반영)
streamdeck stop|s com.sonky.media-controller
streamdeck validate com.sonky.media-controller.sdPlugin   # 매니페스트/레이아웃/이미지 스키마 검증
streamdeck pack com.sonky.media-controller.sdPlugin       # 배포용 .streamDeckPlugin 생성
streamdeck list                               # 설치된 플러그인 목록
```

**개발 루프**: `streamdeck dev` → `streamdeck link …` (각 1회) → 이후 `npm run watch`. watch가 빌드 후 자동으로 `restart`를 호출하므로 코드 저장만 하면 Stream Deck에 반영된다. 디버깅은 `Nodejs.Debug: "enabled"` + VS Code [Attach to Plugin](media_controller/.vscode/launch.json) 구성으로 attach.

타입체크는 별도 스크립트 없이 `npm run build`(rollup의 `@rollup/plugin-typescript`)가 겸한다.

## 아키텍처

데이터 흐름은 한 방향이고 플랫폼 의존은 한 군데로 격리되어 있다:

```
src/plugin.ts                 진입점: 컨트롤러 1개 생성 → 세 액션에 주입 + 등록 + streamDeck.connect()
  ├─ actions/now-playing.ts   다이얼+키 액션 — 표시·재생/정지 (surface 별 렌더 분기)
  ├─ actions/next.ts          키 전용 액션 — 누름 → next()
  ├─ actions/previous.ts      키 전용 액션 — 누름 → previous()
        └─ media/controller.ts  createMediaController(): process.platform 분기 (유일한 분기점)
              ├─ media/darwin.ts   macOS 브리지 — vendored mediaremote-adapter (WIRED)
              └─ media/windows.ts  Windows 브리지 — vendored smtc-helper(.NET) (구현, ⚠ 미검증)
        media/types.ts          MediaController 인터페이스 + NowPlaying 타입 (컨슈머가 의존하는 유일한 계약)
```

- **액션은 플랫폼을 모른다.** `MediaController` 인터페이스(`getNowPlaying`/`playPause`/`next`/`previous`)에만 의존한다. 새 미디어 백엔드(예: 특정 앱의 로컬 API)를 추가해도 `controller.ts`의 분기와 새 구현 파일만 손대면 된다.
- **컨트롤러 1개 공유**: plugin.ts에서 `createMediaController()`를 1회 호출해 세 액션 생성자에 주입한다. 하나의 OS 미디어 세션 = 하나의 브리지로, 중복 `stream` 프로세스를 막는다. Next/Previous는 단발 `send`만 하므로 stream 프로세스를 띄우지 않는다(`#ensureStream`는 `getNowPlaying`에서만 호출되는 lazy 경로).
- **컨트롤 매핑**: (다이얼) 회전 → `next`/`previous`, 누름·터치 → `playPause` (`onDialRotate`/`onDialDown`/`onTouchTap`). (키) Now Playing 키 누름 → `playPause` (`onKeyDown`), Next/Previous 키 누름 → `next`/`previous`. 키는 누름 1동작뿐이라 회전 대체로 Next/Previous를 별도 액션으로 분리했다.
- **렌더링 (surface 별 분기)**: 액션은 `POLL_INTERVAL_MS`(1s)마다 `getNowPlaying()`을 호출하지만, 이는 브리지의 **영속 `stream` 프로세스가 갱신해 둔 캐시 값을 읽을 뿐**이라 가볍다(곡 변경은 stream이 push). 인스턴스별 타이머를 `#timers` Map으로 관리하고, 직전 렌더와 시그니처(`title artist album`)가 같으면 렌더를 건너뛴다(`#lastSig` — 앨범아트 base64 재전송 방지). `#render`에서 `isDial()`→`setFeedback`(터치스트립 레이아웃), 키→`setImage`(앨범아트 data URI; 없으면 `undefined`로 manifest 기본 키 아이콘) + `setTitle`(곡 제목)로 갈린다.

### 손대기 전에 알아야 할 결합 관계 (gotchas)

- **레이아웃 키 ↔ setFeedback 키 (다이얼 전용)**: [layouts/now-playing.json](media_controller/com.sonky.media-controller.sdPlugin/layouts/now-playing.json)의 item `key`(`albumArt`/`title`/`artist`/`album`)와 액션의 `setFeedback({ … })` 키가 정확히 일치해야 화면에 그려진다. 한쪽만 바꾸면 조용히 표시가 안 된다. 텍스트는 문자열, pixmap(`albumArt`)은 `{ value }` 형태로 넘긴다. **키(Keypad)는 레이아웃을 쓰지 않는다** — `setImage`(이미지/`data:` URI)+`setTitle`(문자열)로 직접 그린다.
- **다이얼 vs 키 surface 분기**: `onWillAppear`의 `ev.action`은 `DialAction | KeyAction` 유니온이다. `isDial()`/`isKey()` 타입가드로 좁힌 뒤 surface 별 렌더 API(`setFeedback` vs `setImage/setTitle`)를 호출한다. Now Playing 액션은 둘 다(`Controllers: ["Encoder","Keypad"]`), Next/Previous는 키 전용(`["Keypad"]`).
- **액션 UUID ↔ 매니페스트 UUID**: `@action({ UUID })`와 [manifest.json](media_controller/com.sonky.media-controller.sdPlugin/manifest.json) Actions[].UUID가 완전히 같아야 이벤트 라우팅이 된다. 액션 3개(`now-playing`/`next`/`previous`) 모두.
- **키 아이콘 = 정적 매니페스트 이미지**: Next/Previous 키는 동적 표시가 없어 manifest `Icon`(20/40px)·`States[].Image`(72/144px) 정적 PNG만 쓴다([imgs/actions/next/](media_controller/com.sonky.media-controller.sdPlugin/imgs/actions/next/)·[previous/](media_controller/com.sonky.media-controller.sdPlugin/imgs/actions/previous/), now-playing 디자인 계열로 생성). Now Playing 키의 기본 이미지는 `States[0].Image`(`now-playing/key`)이고, 재생 중이면 `setImage`로 앨범아트가 이를 덮는다. **Now Playing/Next 키는 play/pause 상태 아이콘을 토글하지 않는다**(단일 State, `setState` 미사용) — 다이얼과 동일한 의도된 한계.
- **빌드 산출물**: `*.sdPlugin/bin/`은 rollup 출력이며 gitignore 대상. 소스는 `src/`만. 매니페스트 `CodePath`는 `bin/plugin.js`를 가리킨다.
- **Node 런타임**은 Stream Deck 앱이 번들(매니페스트 `Nodejs.Version`)한다. 로컬 Node 버전과 무관하며, 앱이 7.1 미만이면 플러그인이 로드되지 않는다.
- **vendored 네이티브 의존**: [vendor/mediaremote-adapter/](media_controller/com.sonky.media-controller.sdPlugin/vendor/mediaremote-adapter/)의 perl 스크립트 + `MediaRemoteAdapter.framework`(유니버설, ad-hoc 서명)는 **gitignore 대상이 아니며 커밋된다**(self-contained 배포). `darwin.ts`는 `import.meta.url` 기준 `../vendor/...`로 경로를 해석한다 — 번들 레이아웃을 바꾸면 이 경로도 같이 바꿔야 한다. 프레임워크는 ad-hoc 서명이라 복사 시 서명이 유지돼야 로드된다(`codesign --verify`로 확인).
- **공용 tsconfig는 루트 base**: 공통 컴파일러 옵션은 루트 [tsconfig.base.json](tsconfig.base.json)에 모으고, 각 워크스페이스 [tsconfig.json](media_controller/tsconfig.json)은 `extends: "../tsconfig.base.json"` + 자기 `include`/`exclude`만 둔다. base가 `@tsconfig/node20`을 extends 하므로 그 의존성은 **루트** devDependencies에 있다(워크스페이스 아님). 새 플러그인은 같은 패턴으로 base를 extends 한다. rollup(`@rollup/plugin-typescript`)은 빌드 cwd(=워크스페이스)의 `tsconfig.json`을 자동 탐색하므로 파일명/위치를 바꾸면 안 된다.
- **모노레포 hoist ↔ @types/node**: workspaces가 의존성을 루트 `node_modules`로 hoist 하면 플러그인 폴더의 `node_modules`가 비어, tsc가 node 타입(`process`/`Buffer`/`node:*`)을 자동 포함하지 못한다. base의 `"types": ["node"]`가 이를 해결한다(워크스페이스가 extends로 상속) — 빼면 빌드에 TS 경고가 쏟아진다.
- **공용 lint 설정은 보호됨**: 루트 [eslint.config.mjs](eslint.config.mjs)·[.prettierrc.json](.prettierrc.json)은 `config-protection` 훅 대상이라 Write/Edit가 차단된다. 정당한 변경이면 `~/.claude/settings.json`에서 해당 훅을 잠시 비활성화 후 수정한다. 포매팅은 Prettier에 일임하고 ESLint는 `eslint-config-prettier`로 충돌 룰만 끈다.

## 미디어 백엔드: 핵심 제약과 현재 상태

**macOS 15.4+ 부터 `MRMediaRemoteGetNowPlayingInfo`가 앱 내부 직접 호출 시 nil을 반환**한다(곡 정보 취득 차단). 제어 명령(`MRMediaRemoteSendCommand`)은 여전히 동작한다. 따라서 OS 미디어 세션만으로는 macOS에서 곡 정보를 얻을 수 없고, out-of-process 브리지가 필요하다.

채택한 브리지:

- **macOS** (✅ wired): [`ungive/mediaremote-adapter`](https://github.com/ungive/mediaremote-adapter) v0.7.6 (BSD-3). `/usr/bin/perl`은 MediaRemote 사용 권한이 있고, perl이 동적 로드하는 헬퍼 프레임워크가 stdout으로 곡 정보를 출력한다 — 15.4+ 제약을 우회.
- **Windows** (🚧 구현·미검증): vendored `smtc-helper`(.NET) exe 에 shell out → SMTC(`GlobalSystemMediaTransportControlsSessionManager`)로 곡 정보 + 제어. 브라우저의 YouTube Music 포함 대부분 플레이어 지원. **Windows 머신에서 빌드·검증 필요**(이 저장소는 macOS에서 작성됨).

### macOS 브리지 동작 (darwin.ts)

호출 형태: `/usr/bin/perl <vendor>/mediaremote-adapter.pl <vendor>/MediaRemoteAdapter.framework <function> [args]`

- **곡 정보**: 영속 `stream --no-diff --debounce=250` 프로세스를 한 번 띄우고 줄단위 JSON(`{"type":"data","diff":false,"payload":{…}}`)을 파싱해 최신 상태를 캐시. `payload`가 `{}`면 재생 없음(`null`). 키: `title`/`artist`/`album`/`playing`(bool)/`artworkData`(base64)+`artworkMimeType` → `data:` URI.
- **제어**: 단발 `send <MRACommand>` — `2`=TogglePlayPause, `4`=NextTrack, `5`=PreviousTrack (`include/MediaRemoteAdapter.h`의 `MRACommand` enum).
- **수명/orphan**: stream 프로세스가 죽으면 `#stream`을 비워 다음 폴링에 자연 재기동(self-heal). 플러그인 종료 시 `process.once('exit'|'SIGTERM'|'SIGINT')`에서 SIGTERM으로 자식 정리.
- **엔타이틀먼트 확인**: `perl … <framework> test` (exit 0 = 정상).

### 프레임워크 재빌드 (cmake 불필요)

```bash
cd media_controller
./scripts/build-mediaremote-adapter.sh            # 기본 v0.7.6
./scripts/build-mediaremote-adapter.sh v0.7.6     # 특정 태그
```

clang으로 유니버설(x86_64+arm64) 컴파일 → ad-hoc 서명 → `vendor/`에 배치 → `test`로 검증. 외부 서드파티 소스를 컴파일·실행하므로 자동 권한 모드에서 차단될 수 있다(명시적 승인 필요).

### Windows 브리지 동작 (windows.ts) — ⚠ 미검증

darwin.ts 와 **동일한 구조**(영속 stream 캐시 + 단발 send + 서킷브레이커 + 시그널 정리). macOS의 perl+프레임워크 자리에 vendored `smtc-helper.exe`(.NET, `Windows.Media.Control`)가 들어간다.

호출 형태: `<vendor>/smtc-helper/smtc-helper.exe <get|stream|send> [cmd]`

- **곡 정보**: `stream` 이 SMTC 변경마다 줄단위 JSON(payload 또는 `"null"`)을 출력 → 캐시. 키는 macOS와 동일(`title`/`artist`/`album`/`playing`/`artworkData`/`artworkMimeType`).
- **제어**: `send playpause|next|previous` → `TryTogglePlayPauseAsync`/`TrySkipNextAsync`/`TrySkipPreviousAsync`.
- **헬퍼 소스**: [smtc-helper/](media_controller/smtc-helper/) (`Program.cs` + `smtc-helper.csproj`, `net8.0-windows10.0.19041.0`).

헬퍼 빌드·vendor (Windows + .NET 8 SDK 필요):

```powershell
cd media_controller
pwsh scripts/build-smtc-helper.ps1                # 프레임워크 의존(작음, .NET 런타임 필요)
pwsh scripts/build-smtc-helper.ps1 -SelfContained # 자체 포함(런타임 불필요, 큼)
```

검증되면 SPEC/이 문서의 "미검증" 표기를 제거하고, vendored `smtc-helper.exe`를 커밋한다(`*.sdPlugin/vendor/`는 gitignore 대상 아님).

### 현재 wired vs Roadmap

**Wired (검증됨, macOS)**: 플러그인 골격, 다이얼(Encoder) 액션, **키(Keypad) 지원 — Now Playing 키(`setImage` 앨범아트 data URI + `setTitle`) + Next/Previous 키 전용 액션 + 컨트롤러 1개 공유 주입**, 컨트롤 매핑, 터치스트립/키 stream 캐시 렌더링(dedupe), 플랫폼 분기, `MediaController` 계약, **macOS 곡 정보 + 재생/일시정지/다음/이전 (vendored mediaremote-adapter)**, 브리지 오류 시 "설정 필요"/"재생 없음" graceful degradation. (macOS 실기기 검증 완료. Windows는 전체 미검증 — 아래.)

**구현됨 · 미검증 (Windows)**: `media/windows.ts` + vendored `smtc-helper`(.NET). 코드/구조는 macOS와 동일 패턴으로 완성. **Windows 머신에서 빌드(`scripts/build-smtc-helper.ps1`)·실행 검증이 남아 있다** — 검증 후 `smtc-helper.exe` 커밋 + "미검증" 표기 제거.

**Roadmap**:

1. 배포 시 프레임워크 **공증(notarization)** 검토 — 현재는 ad-hoc 서명이라 본인 머신/개발용엔 충분하나 광범위 배포엔 Gatekeeper 이슈 가능.
