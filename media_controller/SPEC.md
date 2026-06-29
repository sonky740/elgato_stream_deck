# Media Controller (Stream Deck + 플러그인)

## Purpose

Stream Deck **+** 의 다이얼 1개로 OS 미디어 세션을 표시·제어한다. 현재 재생 중인 곡(앨범아트·제목·가수·앨범)을 터치스트립에 보여주고, 회전으로 곡 이동, 누름/터치로 재생·일시정지한다. 특정 앱에 묶이지 않고 OS 미디어 세션을 쓰므로 YouTube Music(브라우저 PWA 포함)을 비롯한 모든 미디어 플레이어가 대상이다.

핵심 제약: macOS 15.4+ 는 앱 내부에서 `MRMediaRemoteGetNowPlayingInfo` 호출 시 nil 을 반환한다(곡 정보 차단). 따라서 곡 정보는 반드시 out-of-process 브리지로 얻어야 한다.

## Features

- **Now Playing 표시**: 터치스트립에 앨범아트 + 제목 + 가수 + 앨범 렌더 (1s 폴링, 변경 시에만 갱신)
- **재생 / 일시정지**: 다이얼 누름(`onDialDown`) 또는 터치(`onTouchTap`)
- **다음 / 이전 곡**: 다이얼 회전(`onDialRotate`) — 시계방향 다음, 반시계 이전
- **Graceful degradation**: 재생 정보 없음 → "재생 없음", 브리지 영구 실패 → "설정 필요"

## Business Rules

- 곡 정보(`title`)가 없으면 `NowPlaying`은 `null` 로 보고 "재생 없음"을 표시한다.
- 직전 렌더 시그니처(`title artist album`)가 같으면 `setFeedback`을 생략한다(앨범아트 base64 재전송 방지).
- 다이얼 회전: `ticks > 0` → 다음, `ticks < 0` → 이전, `ticks === 0` → 무시.
- **macOS**: 인-프로세스 MediaRemote 직접 호출 금지(15.4+ nil). 곡 정보·제어 모두 vendored 어댑터를 `/usr/bin/perl`로 out-of-process 실행해 얻는다.
- 제어 명령은 OS의 "현재 now-playing 앱"에 전달된다(특정 앱 지정 불가) — `MRACommand` ID: `2`=TogglePlayPause, `4`=NextTrack, `5`=PreviousTrack.
- 브리지 stream 프로세스가 정상 가동(≥3s) 후 죽으면 다음 폴링에 재기동(self-heal). 단, 즉시 종료가 연속 3회면 브리지를 영구 비활성화하고 이후 `getNowPlaying`은 에러를 던진다(초당 재기동 루프 차단 + "설정 필요" 표면화).
- 레이아웃 item `key` 와 `setFeedback` 키는 정확히 일치해야 렌더된다(`albumArt`·`title`·`artist`·`album`).

## Architecture

플랫폼 의존은 `media/controller.ts` 한 곳에만 있고, 액션은 `MediaController` 인터페이스에만 의존한다.

```
src/plugin.ts                 진입점: 액션 등록 + streamDeck.connect()
  └─ actions/now-playing.ts   Encoder(다이얼) 액션 — UI/이벤트만
        └─ media/controller.ts  createMediaController(): process.platform 분기 (유일한 분기점)
              ├─ media/darwin.ts   macOS — vendored mediaremote-adapter (영속 stream 캐시 + send)
              └─ media/windows.ts  Windows — SMTC (스텁)
        media/types.ts          MediaController 인터페이스 + NowPlaying 타입 (유일한 계약)
```

## File Structure

| 파일                                                              | 역할                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/plugin.ts`                                                   | 진입점. 로그 레벨 설정, `NowPlayingAction` 등록, `streamDeck.connect()`          |
| `src/actions/now-playing.ts`                                      | Encoder 액션. 폴링 렌더(`#timers`/`#lastSig` dedupe) + 회전/누름/터치 → 제어     |
| `src/media/types.ts`                                              | `NowPlaying` 타입 + `MediaController` 인터페이스 (컨슈머가 의존하는 계약)        |
| `src/media/controller.ts`                                         | `createMediaController()` — `process.platform` 분기 (유일한 플랫폼 분기점)       |
| `src/media/darwin.ts`                                             | macOS 브리지. 영속 `stream` 자식으로 상태 캐시, `send`로 제어, 서킷브레이커·정리 |
| `src/media/windows.ts`                                            | Windows 브리지 (SMTC) — 미구현 스텁                                              |
| `com.sonky.media-controller.sdPlugin/manifest.json`               | 플러그인/액션 메타. Encoder 컨트롤러, layout·TriggerDescription                  |
| `com.sonky.media-controller.sdPlugin/layouts/now-playing.json`    | 터치스트립 커스텀 레이아웃(pixmap+text)                                          |
| `com.sonky.media-controller.sdPlugin/vendor/mediaremote-adapter/` | vendored perl 스크립트 + `MediaRemoteAdapter.framework`(유니버설, ad-hoc 서명)   |
| `scripts/build-mediaremote-adapter.sh`                            | 어댑터 프레임워크 재현 빌드(clang, cmake 불필요)                                 |

## Dependencies

| 대상                                                                    | 용도                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@elgato/streamdeck` (SDK)                                              | 액션 등록, 이벤트, `setFeedback`, 로거                           |
| vendored `ungive/mediaremote-adapter` (BSD-3)                           | macOS 곡 정보 + 제어 (out-of-process)                            |
| `/usr/bin/perl` (macOS 시스템)                                          | MediaRemote 사용 권한이 있는 런처. 어댑터 프레임워크를 동적 로드 |
| SMTC `GlobalSystemMediaTransportControlsSessionManager` (Windows, 예정) | Windows 곡 정보 + 제어                                           |
| Stream Deck 앱 7.1+                                                     | Node 24 런타임 번들, 플러그인 로드                               |

## Glossary

| 용어                | 정의                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| Encoder / 다이얼    | Stream Deck + 의 회전·누름 가능한 노브. 터치스트립과 연동            |
| 터치스트립          | 다이얼 위의 LCD. `setFeedback`/`layout`으로 렌더                     |
| NowPlaying          | 정규화된 재생 상태(title/artist/album/isPlaying/artworkDataUri)      |
| MediaController     | 플랫폼 무관 제어 계약(`getNowPlaying`/`playPause`/`next`/`previous`) |
| MRACommand          | MediaRemote 제어 명령 ID (2=재생토글, 4=다음, 5=이전)                |
| mediaremote-adapter | macOS 15.4+ MediaRemote 차단을 우회하는 perl+프레임워크 브리지       |
| SMTC                | Windows System Media Transport Controls                              |

## Data Flow

곡 정보 (push → 캐시 → 폴링 렌더):

```
[macOS MediaRemote 변경 알림]
    │  (perl ... stream --no-diff, 줄단위 JSON)
    ▼
darwin.ts: stdout 파싱 → #current 캐시
    │
    ▼  (액션 1s 폴링 — 캐시만 읽음)
now-playing.ts #refresh → 시그니처 비교 → 변경 시 setFeedback → 터치스트립
```

제어 (이벤트 → 단발 send):

```
[다이얼 회전/누름/터치]
    │
    ▼
now-playing.ts → controller.next/previous/playPause()
    │
    ▼
darwin.ts #send → perl ... send <MRACommand> → 현재 now-playing 앱
```
