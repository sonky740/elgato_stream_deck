# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 저장소 개요

Elgato **Stream Deck +** 용 플러그인 **npm workspaces 모노레포**. 각 플러그인은 루트 하위 디렉토리에 자기완결적으로 들어가고(독립 빌드), **ESLint·Prettier·vitest 설정은 루트에서 공용**으로 가져다 쓴다. 새 플러그인은 루트에 디렉토리를 만들고 루트 [package.json](package.json)의 `workspaces`에 추가한다.

| 워크스페이스                           | 플러그인                                                  | 상태                             |
| -------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| [media_controller/](media_controller/) | OS 미디어 세션으로 현재 재생 곡 표시·제어 (모든 플레이어) | macOS 검증 완료 / Windows 미검증 |
| [c_ai_usage/](c_ai_usage/)             | Claude·Codex 구독 사용량 한도를 5시간·주간 게이지로 표시  | macOS 검증 완료 / Windows 미검증 |

대상: macOS 12+ / Windows 10+. Stream Deck 앱 **7.1+** 필요(매니페스트 `SDKVersion: 3`, `Nodejs.Version: 24`).

사람이 읽는 입구는 [README.md](README.md)(모노레포)와 각 플러그인의 `README.md`(설치·사용·플랫폼별 준비물)다. **설치 절차·컨트롤 매핑·요구사항·알려진 한계를 바꾸면 해당 README 도 같이 고친다** — 이 파일과 SPEC 은 그 사실을 중복해서 갖지 않으므로 README 가 유일한 사용자용 기술이다.

## 명령어

**의존성 설치·lint·format은 루트에서** (npm workspaces — 한 번 설치하면 전 플러그인이 공용 도구를 공유):

```bash
npm install                  # 루트 1회 — 모든 워크스페이스 의존성 + 공용 devtool 설치
npm run lint                 # eslint . (전 워크스페이스)
npm run lint:fix             # eslint . --fix
npm run format               # prettier --write .
npm run format:check         # prettier --check .
npm run build                # 모든 워크스페이스 빌드 (npm run build --workspaces --if-present)
npm test                     # vitest run (전 워크스페이스의 src/**/*.test.ts)
npm run test:watch           # vitest
```

테스트는 **루트 vitest 하나**가 전 워크스페이스를 돈다. 각 워크스페이스 `tsconfig.json`은 `src/**/*.test.ts`를 `exclude` 해야 한다 — 안 그러면 rollup의 타입체크가 테스트 파일까지 검사해 vitest 전역(`describe`/`it`)을 못 찾고 빌드가 깨진다.

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

## 아키텍처 — media_controller

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

## 아키텍처 — c_ai_usage

Claude·Codex 구독 사용량 한도 게이지. 상세 계약·비즈니스 규칙은 [c_ai_usage/SPEC.md](c_ai_usage/SPEC.md), 결정 이력은 [c_ai_usage/DECISIONS.md](c_ai_usage/DECISIONS.md), 근거·실측값은 [ai-limits-plan.md](ai-limits-plan.md), 실행 상태는 [ai-limits-checklist.md](ai-limits-checklist.md).

media_controller와 **폴링 구조가 정반대**다. 거기서는 인스턴스마다 1초 `setInterval`이 로컬 캐시를 읽지만, 여기서는 매 폴링이 레이트리밋된 HTTPS 요청이다.

### 손대기 전에 알아야 할 것 (c_ai_usage gotchas)

- **인스턴스는 폴링 타이머를 갖지 않는다.** 프로바이더당 공유 서비스(`usage/service.ts`) 하나가 타이머·last-good 캐시를 소유하고 액션은 구독만 한다. media_controller의 `#timers` Map 관용구를 복사하면 다이얼 2개를 올리는 순간 요청률이 2배가 된다.
- **컨트롤 매핑**: (키) 누름 → 차트 순환. (다이얼) 회전 → 회전 **방향으로 차트 한 칸**(양끝에서 감싸므로 같은 방향으로 계속 돌려도 계속 바뀐다), 누름·터치 탭 → 기준(사용량↔남은양) 전환. 스텝은 `ticks` **크기가 아니라 방향(±1)**이다 — 빠르게 튕기면 한 이벤트에 ticks 가 여러 개 실려 오고, 차트가 2종이라 크기만큼 이동하면 짝수 입력이 제자리가 되어 반응이 없는 것처럼 보인다. 회전은 400ms **leading-edge throttle**(`ROTATE_THROTTLE_MS`)로 비율을 제한한다 — debounce 로 바꾸면 회전이 멎을 때까지 화면이 가만히 있어 순환으로 되돌린 이유가 되살아난다. **버린 이벤트로 창을 밀지 않는다**(밀면 계속 돌리는 동안 영구히 막힌다). 키는 누름을 차트에 쓰므로 기준이 PI 전용으로 남는다.
- **⚠ 인스턴스 설정을 구독 콜백에 캡처하면 안 된다.** `onWillAppear`의 `ev.payload.settings`를 클로저에 담으면 폴링 렌더가 appear 시점 스냅샷에 고정되어, 기기·PI에서 바꾼 차트가 다음 폴링에 **조용히 되돌아간다**. 현재 설정은 `#settings` Map이 소유한다 — 네 Map(`#detachers`·`#lastSent`·`#lastVm`·`#settings`)의 수명이 `onWillDisappear` 한 곳에서 갈리게 유지한다.
- **실패가 요청 빈도를 올리는 경로를 만들면 안 된다.** 이 저장소 히스토리에 실제 사고가 있다 — 삭제된 서드파티 플러그인이 백오프 없이 계정 OAuth 토큰으로 ~930 req/min을 쏴 로그 390MB를 남겼다(계획서 §0). 실패 시 대기는 항상 폴링 간격 이상, 연속 4회부터 고정 쿨다운.
- **토큰 refresh 금지.** refresh token이 1회용으로 회전해 갱신하면 Claude Code CLI가 로그아웃된다. 폴링마다 키체인을 다시 읽는 것으로 대체한다(access token 수명 ≈5시간).
- **`utilization: number | null`을 끝까지 유지한다.** `null`은 0이 아니다. `basis: remaining`에서 `100 - null`이 "100% 남음"으로 표시되면 진실이 "모름"인데 여유 만점이라고 오표시된다.
- **창 라벨은 슬롯 위치가 아니라 창 길이에서 파생한다.** Codex의 `primary` 슬롯이 5시간→주간으로 바뀐 이력이 있다.
- **레이아웃은 pixmap 하나로 200×100 전체를 덮는다**([layouts/usage.json](c_ai_usage/com.sonky.c-ai-usage.sdPlugin/layouts/usage.json)). 캔버스를 매번 통째로 다시 그리므로 슬롯 공란·차트 전환·창 개수 변화가 전부 공짜다 — layout item의 `type`/`key`/`rect`는 런타임 변경이 불가능하기 때문에 이게 유일하게 단순한 길이다. `setFeedback` 키는 `canvas` 하나뿐.
- **게이지는 in-plugin SVG 생성**(`render/gauge.ts`, 순수 함수)이다. 도넛 호는 `stroke-dasharray`가 아니라 arc path(`A`)로 그리고 `dominant-baseline`을 쓰지 않는다 — 래스터라이저의 기능 지원 범위가 문서화돼 있지 않아 기본 기능만 쓴다. 실기기 확인 결과 arc·`<text>`·**한글 글리프까지 그려진다**.
- **두 창은 주역 1 + 조역 1 위계**다(`lead()`) — **단 다이얼 도넛만 같은 크기 셀 2개**로 위계를 색으로만 준다(200px 폭이 남아서). 5H를 모르고 주간만 알면 **주간이 승격**된다 — Codex가 항상 이 모양이라 예외가 아니라 정상 경로다. 승격은 자리 크기가 다른 세 레이아웃에서는 **자리의 이동**이고 다이얼 도넛에서는 **강조의 이동**이다: `dialDonut`은 자리를 5H·주간으로 고정한 채 `left === p` 로 강조만 옮긴다. 자리를 옮기면 5H가 폴링 사이에 사라질 때 두 셀이 맞바뀌어 눈이 매번 다시 찾는다. 승격돼도 5H 자리는 `—` + `주간만 제공`으로 남는다(모름을 화면에서 지우지 않는다).
- **⚠ 캔버스를 칠하지 않는다 — 어두운 배경이 코드 밖의 가정이 됐다.** `plate()`를 없애 스트림덱 프로필 배경이 비치는데, 그 대가로 `ACCENT_DIM`(pre-blend 기준색 `#16181c`)·`RULE`·`TEXT`가 전부 **어두운 배경 위에서만** 보인다. 밝은 프로필 배경이면 임계 색만 남고 판독 숫자가 사라진다(헤드리스 Chrome 으로 `#d8dce2` 위에 구워 확인). 배경판을 되살리는 것과 **배경색으로 채운 가림막**(없앤 chip이 그랬다)을 넣는 것이 같은 실수인데 둘 다 어두운 데스크에서는 정상으로 보인다 — `gauge.test.ts`의 "캔버스를 칠하지 않는다" 불변식이 둘을 같이 막는다.
- **임계 색은 값이 아니라 위험도로 판정한다**(`risk()`). 남은양 기준에서는 `100 - x`로 뒤집힌다 — 값으로 판정하면 남은양 기준에서 여유가 빨개진다. **임계값 자체는 `risk()`가 아니라 `resolveThresholds()`(settings.ts)가 소유한다** — 인스턴스 설정이고 기본값은 80·95다. 거기서 `warnAt <= critAt` 불변식을 세우므로(뒤집히면 warn을 crit까지 끌어내려 amber 단계가 사라진다) `risk()`는 그 전제를 다시 확인하지 않는다. `RenderOptions.thresholds`는 **필수**다 — 옵셔널로 두면 호출부가 빠뜨려도 조용히 기본값으로 그려져 설정이 먹지 않는다. 조역은 안전할 때만 흐린 accent이고 위험해지면 주역과 같은 강도로 올라온다(`softColor`).
- **남은 시간은 폴링 해상도까지만 맞다.** 렌더 계기가 폴링뿐이라 카운트다운은 최대 폴링 간격(기본 300s)만큼 낡는다. 렌더 타이머를 새로 두면 인스턴스별 타이머 수명 관리가 화면 갱신에도 생긴다 — 공유 poller를 둔 이유와 같은 비용이라 v1은 낡음을 수용한다. 부수효과로 `#lastSent` dedupe는 거의 걸리지 않게 됐다(설정 변경 경로에서만 의미가 있다).
- **`clampLabel`에 `letter-spacing`을 빼먹으면 안 된다.** 글자당 그만큼씩 늘어나 8글자에서 5px가 새고, 그 5px가 라벨을 옆 게이지 위로 밀어 넣는다(다이얼 바에서 실제로 그랬다). 라벨은 서버가 주는 스코프명(`WK Oauth apps` 등)이라 길이가 미지다.
- **⚠ raw SVG 문자열은 pixmap에서 안 그려진다.** Elgato `layout.json`은 pixmap `value`가 "or an SVG `string`"을 받는다고 적었지만 실제로는 빈 화면이 되고 **전송 오류도 나지 않아 조용히 빈다**(값이 경로로 먼저 해석되는 것으로 보인다 — 스키마 설명의 첫 항목이 경로다). **data URI로 보내야 한다.** `actions/gauge-action.ts`의 `encodeSvg()`가 그 유일한 지점이고, 문서화된 base64 형식을 쓴다(`charset=utf8`도 이 기기에서 동작하지만 어디에도 문서화돼 있지 않다). 키의 `setImage`도 같은 base64 경로를 쓴다(실기기 확인).
- **⚠ SVG 색은 6자리 `#RRGGBB`만 쓴다.** 8자리 hex(`#RRGGBBAA`)는 색으로 받아들여지지 않아 **조용히 어긋난다** — `stroke`는 채움이 사라지고 `fill`은 검정이 되어 어두운 배경에 묻힌다(실기기 2026-08-04, 키 도넛의 WK 링이 이렇게 안 채워졌다). 반투명이 필요하면 배경 위에 미리 섞어 6자리로 굳힌다([render/gauge.ts](c_ai_usage/src/render/gauge.ts)의 `ACCENT_DIM`). `preview/` 컨택트시트는 브라우저가 그려서 이 부류를 못 잡는다 — `gauge.test.ts`의 "모든 fill·stroke 가 `#RRGGBB` 아니면 `none`" 불변식이 가드다.
- **응답 본문을 로그에 쓰지 않는다.** Codex 사용량 응답에 `email`·`user_id`·`account_id`가 평문으로 온다. 그래서 이 워크스페이스는 `logger.setLevel('info')`다(media_controller의 `'trace'`를 복사하면 안 된다). Claude 키체인 blob에는 MCP 서버별 clientSecret이 동거하므로 `claudeAiOauth` 한 필드만 읽는다.
- **`preview/`는 생성물**(gitignore). `npm test`가 매번 디렉토리를 비우고 SVG + `index.html` 컨택트시트를 다시 만든다(픽스처 이름을 바꿨을 때 옛 SVG가 섞이는 것을 막는다). 읽히는지는 눈으로만 확인되므로 헤드리스 Chrome으로 **실제 기기 픽셀 크기**에 래스터라이즈해서 본다 — 키는 SD+ HID 해상도인 **120×120**(144 SVG가 축소돼 올라간다), 다이얼은 200×100 그대로다.
- **아이콘 16장은 스크립트 생성물이지만 커밋된다**([scripts/build-icons.mjs](c_ai_usage/scripts/build-icons.mjs), 헤드리스 Chrome). 마크는 270° 트윈 아크 — 두 겹이 두 창, 두 색이 두 프로바이더다. 크기 분기는 **논리 크기**로 판정한다(1x/2x 는 같은 논리 크기의 다른 해상도이므로 같은 분기를 타야 한다 — 40px 자산에 40px 분기를 쓰면 `icon@2x` 가 `icon` 과 다른 그림이 된다). 이 스크립트의 SVG 는 **8자리 hex 를 써도 된다** — 오프라인에서 PNG 로 굽고 기기에는 PNG 가 올라가므로 위의 6자리 제약은 런타임 SVG(`render/gauge.ts`)에만 적용된다.
- **README 스크린샷 4장도 커밋된 생성물**이다([scripts/build-readme-shots.mjs](c_ai_usage/scripts/build-readme-shots.mjs) → `c_ai_usage/docs/*.png`). 입력이 `npm test` 산출물인 `preview/*.svg` 라 **`npm test` → 스크립트** 순서다(스크립트는 SVG 가 없으면 실패한다 — 옛 preview 를 조용히 굽지 않는다). **렌더러를 고치면 같이 다시 굽는다** — 낡아도 아무 신호가 없다. ⚠ 이 PNG 는 **배경을 굽는다**: 런타임 SVG 는 캔버스를 안 칠하므로 그대로 내보내면 투명 PNG 가 되고 GitHub 라이트 모드에서 판독 숫자가 사라진다. `build-icons.mjs` 의 `--default-background-color=00000000` 을 복사하면 정확히 그 실패가 된다.
- **statusline 훅은 선택 설치**다([scripts/statusline-cache.mjs](c_ai_usage/scripts/statusline-cache.mjs)). 설치하면 코딩 중 API 호출이 0이 된다(tier 1). 설치 안 해도 직접 폴링(tier 2)으로 동작한다.
