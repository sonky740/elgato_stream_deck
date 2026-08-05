# Media Controller (Stream Deck + 플러그인)

## Purpose

Stream Deck **+** 의 다이얼 또는 일반 키로 OS 미디어 세션을 표시·제어한다. 현재 재생 중인 곡(앨범아트·제목·가수·앨범)을 터치스트립(다이얼) 또는 키 이미지·타이틀에 보여주고, 다이얼 회전으로 곡을 이동하며 누름/터치로 재생·일시정지한다. 다이얼이 없는 기기(일반 Stream Deck)에서는 Now Playing 키(표시 + 재생/정지) + Next·Previous 키 3개로 같은 기능을 구성한다. 특정 앱에 묶이지 않고 OS 미디어 세션을 쓰므로 YouTube Music(브라우저 PWA 포함)을 비롯한 모든 미디어 플레이어가 대상이다.

핵심 제약: macOS 15.4+ 는 앱 내부에서 `MRMediaRemoteGetNowPlayingInfo` 호출 시 nil 을 반환한다(곡 정보 차단). 따라서 곡 정보는 반드시 out-of-process 브리지로 얻어야 한다. Windows 도 같은 이유(번들 Node 24 + 취약한 네이티브 애드온)로 out-of-process 헬퍼를 쓴다.

## Features

- **Now Playing 표시**: 다이얼은 터치스트립에 앨범아트 + 제목 + 가수 + 앨범, 키는 앨범아트(이미지) + 제목(타이틀) 렌더 (1s 폴링, 변경 시에만 갱신). 다이얼·키 동일한 폴링 경로, surface 별 렌더만 분기.
- **재생 / 일시정지**: 다이얼 누름(`onDialDown`)·터치(`onTouchTap`) 또는 키 누름(`onKeyDown`)
- **다음 / 이전 곡**: 다이얼 회전(`onDialRotate`) — 시계방향 다음, 반시계 이전. 키 기기에서는 별도 **Next / Previous 키 전용 액션**(`onKeyDown` → `next`/`previous`)
- **Graceful degradation**: 재생 정보 없음 → "재생 없음"(en: `Nothing playing`), 브리지 영구 실패 → "설정 필요"(en: `Setup needed`, 다이얼·키 모두). Next/Previous 키는 제어 실패 시 `showAlert`(느낌표).
- **언어**: 화면 문구는 한국어/영어. Stream Deck 앱 언어가 `ko` 면 한국어이고 나머지 7개 언어는 전부 영어다(설정 항목이 아니다).

## Business Rules

- 곡 정보(`title`)가 없으면 `NowPlaying`은 `null` 로 보고 "재생 없음"을 표시한다.
- 직전 렌더 시그니처(`title artist album`)가 같으면 렌더를 생략한다(앨범아트 base64 재전송 방지). 시그니처는 surface 무관 동일.
- surface 별 렌더: 다이얼은 `setFeedback`(터치스트립 레이아웃), 키는 `setImage`(앨범아트 data URI; 없으면 `undefined`로 manifest 기본 키 아이콘) + `setTitle`(곡 제목). `isDial()`/`isKey()`로 분기.
- 다이얼 회전: `ticks > 0` → 다음, `ticks < 0` → 이전, `ticks === 0` → 무시.
- 컨트롤러는 plugin.ts에서 1개만 생성해 세 액션(Now Playing/Next/Previous)에 주입한다 — 하나의 OS 미디어 세션 = 하나의 브리지(중복 stream 프로세스 방지). Next/Previous는 단발 `send`만 하므로 stream 프로세스를 띄우지 않는다(darwin.ts `#ensureStream`는 lazy).
- **macOS**: 인-프로세스 MediaRemote 직접 호출 금지(15.4+ nil). 곡 정보·제어 모두 vendored 어댑터를 `/usr/bin/perl`로 out-of-process 실행해 얻는다. 제어는 `MRACommand` ID(`2`=TogglePlayPause, `4`=NextTrack, `5`=PreviousTrack).
- **Windows**: vendored `smtc-helper`(.NET) exe 에 shell out 해 SMTC(`GlobalSystemMediaTransportControlsSessionManager`)로 곡 정보·제어를 얻는다. 제어는 `playpause`/`next`/`previous` 문자열. (코드 구현 완료, **Windows 미검증** — 검증은 Windows 머신에서.) 미검증인 동안 **매니페스트 `OS` 는 windows 를 선언하지 않는다** — 심사·설치가 선언된 플랫폼을 기준으로 하므로 실행되지 않는 플랫폼을 제공하지 않는다. 검증되면 항목을 되살린다.
- 제어 명령은 OS의 "현재 now-playing 세션"에 전달된다(특정 앱 지정 불가).
- 브리지 stream 프로세스가 정상 가동(≥3s) 후 죽으면 다음 폴링에 재기동(self-heal). 단, 즉시 종료가 연속 3회면 브리지를 영구 비활성화하고 이후 `getNowPlaying`은 에러를 던진다(초당 재기동 루프 차단 + "설정 필요" 표면화). macOS·Windows 동일.
- 레이아웃 item `key` 와 `setFeedback` 키는 정확히 일치해야 렌더된다(`albumArt`·`title`·`artist`·`album`).
- **화면 문구는 `streamDeck.i18n.t()` 를 거치고 키는 영문 원문이다.** 한국어는 `ko.json` 의 `Localization` 이 덮고, 그 밖의 언어는 파일이 없어 키가 그대로 나온다(= 읽히는 영어) — `en.json` 을 두지 않는 이유다. **키에 점(`.`)을 쓰면 안 된다**: 룩업이 키를 dotted path 로 훑어 조용히 번역이 안 된다(그래서 `CLAUDE.md 참고` 는 키가 아니라 값 쪽에만 있다).
- **레이아웃 기본값(`artist: "Connecting"`)은 언어 분기가 없다.** 정적 JSON 이고 첫 `setFeedback` 전 1초 미만만 보이므로 영문으로 굳혔다.
- **로그·`Error` 메시지는 영문 단일이다.** 읽는 쪽이 개발자라 언어 분기를 두지 않는다 — 화면에 나가는 문구와 구분되는 경계다.

## Architecture

플랫폼 의존은 `media/controller.ts` 한 곳에만 있고, 액션은 `MediaController` 인터페이스에만 의존한다. macOS·Windows 브리지는 동일한 구조(영속 stream 헬퍼로 상태 캐시 + 단발 send 제어 + 서킷브레이커)다. 컨트롤러 1개를 plugin.ts에서 만들어 세 액션에 주입한다.

```
src/plugin.ts                 진입점: 컨트롤러 1개 생성 → 세 액션에 주입 + 등록 + connect()
  ├─ actions/now-playing.ts   다이얼+키 액션 — 표시·재생/정지 (surface 별 렌더 분기)
  ├─ actions/next.ts          키 전용 — 누름 → next()
  ├─ actions/previous.ts      키 전용 — 누름 → previous()
        └─ media/controller.ts  createMediaController(): process.platform 분기 (유일한 분기점)
              ├─ media/darwin.ts   macOS — vendored mediaremote-adapter (영속 stream 캐시 + send)
              └─ media/windows.ts  Windows — vendored smtc-helper(.NET) (영속 stream 캐시 + send, ⚠ 미검증)
        media/types.ts          MediaController 인터페이스 + NowPlaying 타입 (유일한 계약)
```

## File Structure

| 파일                                                              | 역할                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/plugin.ts`                                                   | 진입점. 컨트롤러 1개 생성·주입, 세 액션 등록, `streamDeck.connect()`                                                                       |
| `src/actions/now-playing.ts`                                      | 다이얼+키 액션. 폴링 렌더(`#timers`/`#lastSig` dedupe, surface 별 분기) + 회전/누름/터치/키 → 제어                                         |
| `src/actions/next.ts`                                             | Next 키 전용 액션. `onKeyDown` → `next()`, 실패 시 `showAlert`                                                                             |
| `src/actions/previous.ts`                                         | Previous 키 전용 액션. `onKeyDown` → `previous()`, 실패 시 `showAlert`                                                                     |
| `src/media/types.ts`                                              | `NowPlaying` 타입 + `MediaController` 인터페이스 (컨슈머가 의존하는 계약)                                                                  |
| `src/media/controller.ts`                                         | `createMediaController()` — `process.platform` 분기 (유일한 플랫폼 분기점)                                                                 |
| `src/media/darwin.ts`                                             | macOS 브리지. 영속 `stream` 자식으로 상태 캐시, `send`로 제어, 서킷브레이커·정리                                                           |
| `src/media/windows.ts`                                            | Windows 브리지. `smtc-helper.exe` 에 shell out (구현, **Windows 미검증**)                                                                  |
| `smtc-helper/Program.cs`, `smtc-helper.csproj`                    | Windows SMTC 헬퍼(.NET) 소스 — `get`/`stream`/`send`, 앨범아트 base64                                                                      |
| `com.sonky.media-controller.sdPlugin/manifest.json`               | 플러그인/액션 메타. Now Playing(Encoder+Keypad)·Next·Previous(Keypad), layout·States                                                       |
| `com.sonky.media-controller.sdPlugin/ko.json`                     | 한국어. 최상위는 매니페스트 오버라이드(액션 UUID 키), `Localization` 은 런타임 문구                                                        |
| `com.sonky.media-controller.sdPlugin/layouts/now-playing.json`    | 터치스트립 커스텀 레이아웃(pixmap+text)                                                                                                    |
| `com.sonky.media-controller.sdPlugin/vendor/mediaremote-adapter/` | (macOS) vendored perl 스크립트 + `MediaRemoteAdapter.framework`(유니버설, ad-hoc 서명, **플랫 레이아웃** — `pack` 이 심볼릭 링크를 버린다) |
| `com.sonky.media-controller.sdPlugin/vendor/smtc-helper/`         | (Windows) vendored `smtc-helper.exe` — 빌드 산출물(빌드 후 생성)                                                                           |
| `scripts/build-mediaremote-adapter.sh`                            | (macOS) 어댑터 프레임워크 재현 빌드(clang, cmake 불필요)                                                                                   |
| `scripts/build-smtc-helper.ps1`                                   | (Windows) SMTC 헬퍼 빌드·vendor(.NET 8 SDK 필요)                                                                                           |

## Dependencies

| 대상                                                  | 용도                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `@elgato/streamdeck` (SDK)                            | 액션 등록, 이벤트, `setFeedback`, 로거                           |
| vendored `ungive/mediaremote-adapter` (BSD-3)         | macOS 곡 정보 + 제어 (out-of-process)                            |
| `/usr/bin/perl` (macOS 시스템)                        | MediaRemote 사용 권한이 있는 런처. 어댑터 프레임워크를 동적 로드 |
| vendored `smtc-helper`(.NET, `Windows.Media.Control`) | Windows 곡 정보 + 제어 (out-of-process, 미검증)                  |
| Stream Deck 앱 7.1+                                   | Node 24 런타임 번들, 플러그인 로드                               |

npm 의존성(`@elgato/streamdeck` + 빌드 툴체인)은 **루트 [package.json](../package.json)** 이 선언한다 — 이 워크스페이스 `package.json` 에는 `build`/`watch` 스크립트만 있다. vendored 네이티브 의존은 npm 밖이라 이 디렉토리에 그대로 있다.

## Glossary

| 용어                | 정의                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| Encoder / 다이얼    | Stream Deck + 의 회전·누름 가능한 노브. 터치스트립과 연동                        |
| Keypad / 키         | 일반 누름 버튼. 이미지(`setImage`) + 타이틀(`setTitle`)로 렌더, 누름=`onKeyDown` |
| 터치스트립          | 다이얼 위의 LCD. `setFeedback`/`layout`으로 렌더                                 |
| NowPlaying          | 정규화된 재생 상태(title/artist/album/isPlaying/artworkDataUri)                  |
| MediaController     | 플랫폼 무관 제어 계약(`getNowPlaying`/`playPause`/`next`/`previous`)             |
| MRACommand          | (macOS) MediaRemote 제어 명령 ID (2=재생토글, 4=다음, 5=이전)                    |
| mediaremote-adapter | macOS 15.4+ MediaRemote 차단을 우회하는 perl+프레임워크 브리지                   |
| SMTC                | Windows System Media Transport Controls                                          |
| smtc-helper         | SMTC 를 호출해 곡 정보·제어를 중계하는 vendored .NET exe                         |

## Data Flow

곡 정보 (push → 캐시 → 폴링 렌더):

```
[OS 미디어 세션 변경]
    │  (macOS: perl ... stream / Windows: smtc-helper stream — 줄단위 JSON)
    ▼
darwin.ts / windows.ts: stdout 파싱 → #current 캐시
    │
    ▼  (액션 1s 폴링 — 캐시만 읽음)
now-playing.ts #refresh → 시그니처 비교 → 변경 시 다이얼=setFeedback(터치스트립) / 키=setImage+setTitle
```

제어 (이벤트 → 단발 send):

```
[다이얼 회전/누름/터치] · [Now Playing 키 누름] · [Next/Previous 키 누름]
    │
    ▼
now-playing.ts / next.ts / previous.ts → controller.next/previous/playPause()
    │
    ▼
darwin.ts / windows.ts #send → (macOS) perl ... send <MRACommand> / (Windows) smtc-helper send <cmd> → 현재 세션
```
