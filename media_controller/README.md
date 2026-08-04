# Media Controller

**OS 미디어 세션**으로 현재 재생 중인 곡을 Stream Deck + 에 표시하고 제어한다. 특정 앱에 묶이지 않으므로 YouTube Music(브라우저 PWA 포함)을 비롯한 모든 플레이어가 대상이다.

## 요구사항

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| Stream Deck 앱 | **7.1+** (매니페스트 `SDKVersion: 3`)                   |
| 하드웨어       | Stream Deck + (다이얼) 또는 키 있는 아무 모델           |
| OS             | macOS 12+ (검증 완료) / Windows 10+ (⚠ **구현·미검증**) |

Node 런타임은 Stream Deck 앱이 번들한다(로컬 Node 버전과 무관).

## 설치

Marketplace 에 올린 플러그인이 아니라 로컬 설치다.

```bash
npm install                                  # 저장소 루트에서 1회
npm run build -w media-controller

cd media_controller
npx streamdeck dev                                         # 서명 안 된 로컬 플러그인 허용 — 최초 1회
npx streamdeck link com.sonky.media-controller.sdPlugin    # Stream Deck 에 연결 — 최초 1회
```

Stream Deck 앱에 **Media Controller** 카테고리가 생기고 액션 3개를 올릴 수 있다.

macOS 는 vendored 브리지가 저장소에 함께 커밋되어 있어 추가 빌드가 필요 없다. **Windows 는 헬퍼 exe 를 직접 빌드해야 한다** — 아래 [미디어 백엔드](#미디어-백엔드) 참고.

배포용 패키지가 필요하면 `npx streamdeck pack com.sonky.media-controller.sdPlugin`.

## 액션과 컨트롤

| 액션            | surface     | 조작                                              |
| --------------- | ----------- | ------------------------------------------------- |
| **Now Playing** | 다이얼 · 키 | 곡 정보 표시                                      |
|                 | 다이얼      | 회전 → 다음/이전 곡, 누름·터치 탭 → 재생/일시정지 |
|                 | 키          | 누름 → 재생/일시정지                              |
| **Next Track**  | 키          | 누름 → 다음 곡                                    |
| **Previous**    | 키          | 누름 → 이전 곡                                    |

키는 누름 1동작뿐이라 회전을 대체할 Next·Previous 를 별도 액션으로 분리했다. 다이얼 하나면 세 동작이 다 들어가고, 키 기기에서는 **Now Playing + Next + Previous 3개**로 같은 기능을 구성한다.

제어 명령은 OS 의 "현재 now-playing 세션"에 전달된다 — 특정 앱을 지정할 수는 없다.

## 화면

- **다이얼**: 터치스트립에 앨범아트 + 제목 + 가수 + 앨범
- **키**: 앨범아트를 키 이미지로, 곡 제목을 타이틀로

1초마다 갱신하지만 이는 브리지가 캐시해 둔 값을 읽는 것이라 가볍다(곡 변경은 브리지가 push 한다). 직전과 같으면 렌더를 생략한다 — 앨범아트 base64 를 재전송하지 않기 위해서다.

**재생 정보가 없으면** `재생 없음`, **브리지가 영구 실패하면** `설정 필요` 를 표시한다. Next·Previous 키는 제어 실패 시 느낌표(`showAlert`)를 띄운다.

Play/pause 상태 아이콘은 토글하지 않는다(단일 State) — 다이얼과 동일한 의도된 한계다.

## 미디어 백엔드

**macOS 15.4+ 부터 앱 내부에서 `MRMediaRemoteGetNowPlayingInfo` 를 호출하면 nil 이 돌아온다** — 곡 정보 취득이 차단됐다(제어 명령은 여전히 동작한다). 그래서 곡 정보는 반드시 out-of-process 브리지로 얻어야 한다. Windows 도 같은 이유(번들 Node 24 + 취약한 네이티브 애드온)로 헬퍼 프로세스를 쓴다.

두 플랫폼의 브리지가 **같은 구조**다: 영속 stream 프로세스가 줄단위 JSON 으로 상태를 흘리고 플러그인이 캐시하며, 제어는 단발 `send`. stream 이 죽으면 다음 폴링에 재기동하지만 즉시 종료가 연속 3회면 브리지를 영구 비활성화한다(초당 재기동 루프 차단).

### macOS — vendored, 검증 완료

[`ungive/mediaremote-adapter`](https://github.com/ungive/mediaremote-adapter) v0.7.6 을 vendor 한다. `/usr/bin/perl` 이 MediaRemote 사용 권한을 갖고 있고, perl 이 동적 로드하는 헬퍼 프레임워크가 곡 정보를 stdout 으로 낸다 — 15.4+ 제약을 우회하는 경로다.

perl 스크립트와 `MediaRemoteAdapter.framework`(유니버설, ad-hoc 서명)는 **gitignore 대상이 아니며 커밋된다**(self-contained 배포). 프레임워크를 다시 빌드하려면:

```bash
./scripts/build-mediaremote-adapter.sh          # 기본 v0.7.6
./scripts/build-mediaremote-adapter.sh v0.7.6   # 특정 태그
```

clang 으로 유니버설 컴파일 → ad-hoc 서명 → `vendor/` 배치 → `test` 로 검증한다(cmake 불필요). 프레임워크는 ad-hoc 서명이라 복사할 때 서명이 유지돼야 로드된다.

### Windows — 구현 완료, 미검증

vendored `smtc-helper`(.NET, `Windows.Media.Control`)에 shell out 해 SMTC 로 곡 정보와 제어를 얻는다. 소스는 [`smtc-helper/`](smtc-helper/) 에 있지만 **exe 는 커밋되어 있지 않다** — Windows + .NET 8 SDK 에서 직접 빌드해야 한다.

```powershell
pwsh scripts/build-smtc-helper.ps1                 # 프레임워크 의존 (작음, .NET 런타임 필요)
pwsh scripts/build-smtc-helper.ps1 -SelfContained  # 자체 포함 (런타임 불필요, 큼)
```

이 저장소는 macOS 에서 작성됐다. 코드와 구조는 macOS 와 같은 패턴으로 완성됐지만 **실행 검증이 남아 있다.**

## 개발

저장소 루트에서:

```bash
npm run lint
npm run build -w media-controller
npm run watch -w media-controller   # 변경 감지 빌드 + 저장 시 자동 streamdeck restart
```

이 디렉토리에서:

```bash
npx streamdeck validate com.sonky.media-controller.sdPlugin
npx streamdeck restart com.sonky.media-controller
```

타입체크는 별도 스크립트 없이 `npm run build`(rollup 의 `@rollup/plugin-typescript`)가 겸한다.

**디버깅**: 매니페스트 `Nodejs` 에 `"Debug": "enabled"` 를 넣고(배포 대비 지금은 꺼져 있다) VS Code 의 [Attach to Plugin](.vscode/launch.json) 구성으로 attach 한다.

이 워크스페이스에는 단위 테스트가 없다(`npm test` 는 루트에서 돌지만 여기서 집을 파일이 없다). 검증은 실기기 미디어 세션으로 했다. 브리지 JSON 파싱은 픽스처로 덮을 수 있는 지점이라 테스트를 넣을 여지가 남아 있다.

## 알려진 한계

- **Windows 는 구현·미검증.** 검증되면 `smtc-helper.exe` 를 커밋하고 이 표기를 지운다.
- **제어 대상 앱을 지정할 수 없다** — OS 의 현재 세션에 전달된다.
- **play/pause 상태를 아이콘으로 토글하지 않는다**(단일 State, `setState` 미사용).
- 배포 시 프레임워크 **공증(notarization)** 은 검토 대상이다. 현재는 ad-hoc 서명이라 본인 머신·개발용엔 충분하지만 광범위 배포에는 Gatekeeper 이슈가 있을 수 있다.

## 서드파티

|                                                                                      |                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ungive/mediaremote-adapter`](https://github.com/ungive/mediaremote-adapter) v0.7.6 | BSD 3-Clause — © 2025 Jonas van den Berg and contributors. 라이선스 전문은 [vendor/mediaremote-adapter/LICENSE](com.sonky.media-controller.sdPlugin/vendor/mediaremote-adapter/LICENSE) |

## 문서

|                              |                                 |
| ---------------------------- | ------------------------------- |
| [SPEC.md](SPEC.md)           | 계약·비즈니스 규칙 (SSOT)       |
| [DECISIONS.md](DECISIONS.md) | 설계 결정과 이유, 검토한 대안   |
| [../CLAUDE.md](../CLAUDE.md) | 손대기 전에 알아야 할 결합 관계 |
