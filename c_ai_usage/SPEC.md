# C AI Usage (Stream Deck + 플러그인)

## Purpose

Claude 구독의 **5시간 창과 주간 창 사용량을 동시에** 다이얼·키에 게이지로 표시한다. 수치는 계정 범위·서버 계산 값만 쓴다 — 여러 기기에서 AI 를 쓰기 때문에 한 기기의 로컬 사용량 로그로는 합산이 성립하지 않는다.

Codex 도 포함한다 — 단 OpenAI 가 2026-07-13 이후 주간 창만 반환하므로 **Codex 의 5HR 슬롯은 공란이 정상**이다.

## Features

- **Claude Usage** · **Codex Usage** 액션 — 다이얼(터치스트립 200×100) / 키(144×144). 두 창을 **주역 1 + 조역 1** 위계로 그린다: 주역은 퍼센트를 최대 크기로 세우고 조역은 판독값만 붙인다. 예외는 폭이 남는 **다이얼 도넛** 으로, 여기서는 같은 크기 셀 2개를 나란히 두고 위계를 색으로만 준다. 배관은 `actions/gauge-action.ts` 공통, 프로바이더 차이는 주입된 서비스 뒤에 있다.
- 차트 **도넛(헤어라인 링 + 초대형 숫자) / 세그먼트 미터(10칸)**, 기준 **사용량 / 남은양** — Property Inspector 에서 인스턴스별로 고른다. 기본값은 `donut` + `used`.
- **위험도 색**: 주의 임계↑ amber, 위험 임계↑ red (기본 80%·95%, **인스턴스별 설정**). 게이지와 숫자가 함께 올라가고, 남은양 기준에서는 임계가 뒤집힌다.
- **초기화까지 남은 시간**을 창마다 표시한다 — 5H 는 `2h 14m`, 주간은 `3d 4h`.
- **기기 컨트롤**: 키 누름 → 차트 순환. 다이얼 회전 → 회전 방향으로 차트 한 칸(계속 돌리면 계속 순환, 400ms leading-edge throttle), 다이얼 누름·터치 탭 → 기준 전환. 키는 누름을 차트에 쓰므로 기준이 PI 전용으로 남는다.
- 갱신 주기는 **전역 설정** — PI 프리셋 1·3·5·10·30·60분(기본 5분), 경계에서 60~3600s 로 clamp. 프로바이더 공유 자원이라 인스턴스별로 두면 요청률이 곱해진다.
- 2단 읽기: Claude Code statusline 캐시가 신선하면 네트워크 0, 아니면 계정 API 직접 폴링.
- 실패 상태 11종이 서로 구분되는 화면을 갖는다.
- 화면 문구는 **한국어/영어**. Stream Deck 앱 언어가 `ko` 면 한국어, 나머지 7개 언어는 전부 영어다(설정 항목이 아니다). 게이지는 `render/gauge.ts` 의 문구 테이블, 매니페스트는 `ko.json`, PI 는 `ui/i18n.js` 가 각각 소유한다.

## Business Rules

1. **`utilization` 은 `number | null` 이고 `null` 은 0 이 아니다.** 값을 모르는 창은 트랙만 그리고 `—` 를 쓴다. `basis: remaining` 변환을 `null` 에 적용하면 "100% 남음"이 되어 진실이 "모름"인데 여유 만점이라고 표시된다 — 이 설계에서 가장 위험한 오표시다.
2. **창 라벨은 응답의 슬롯 위치가 아니라 창 길이에서 파생한다.** Codex 의 `primary` 슬롯은 2026-03~07 에 5시간 창, 07-13 부터 주간 창을 담았다. 위치로 라벨을 붙이면 주간 숫자에 "5H" 가 붙는다.
3. **슬롯은 2개 고정, 채울 데이터가 없으면 공란.** 창 길이 버킷으로 배정한다 — 5HR ← `0 < durationSec ≤ 86400`, Week ← `durationSec ≥ 259200`. 정확히 300분/10080분을 매칭하지 않는 이유는 벤더가 창 길이를 조정해도 라벨이 깨지지 않게 하기 위해서다.
4. **버킷 안에 여러 창이 있으면 utilization 이 가장 높은 것을 고른다.** `seven_day` 26% 와 `seven_day_opus` 80% 가 함께 오면 사용자의 실제 제약은 후자다.
5. **창 슬롯을 열거하지 않고 순회한다.** 이 계정에서만 13개가 오고 11개가 null 이며 코드네임 슬롯이 계속 추가된다. 이름을 나열하면 새 창이 조용히 누락된다.
6. **200 이지만 본문이 빈 응답은 사용량 0 이 아니라 미권한이다.** 토큰에 `user:profile` scope 가 없으면 서버가 빈 본문으로 단락한다.
7. **429 는 에러가 아니다.** 마지막 성공값을 나이와 함께 보여준다. 인증·엔드포인트가 모두 정상인 상태다.
8. **토큰 refresh 를 절대 하지 않는다.** refresh token 은 1회용으로 회전하므로 여기서 갱신하면 Claude Code CLI 가 무효 토큰을 들고 남아 로그아웃된다. 만료 시 "재로그인 필요"를 렌더하고, CLI 가 다음 실행에서 갱신하면 다음 폴링에 자동 복구된다.
9. **자격증명은 폴링마다 다시 읽는다.** Claude access token 수명이 약 5시간이라 시작 시 1회 읽는 구현은 몇 시간 뒤 조용히 401 이 되어 재시작까지 고장난 채 남는다.
10. **실패가 요청 빈도를 올리는 경로가 없어야 한다.** 실패 시 대기는 항상 폴링 간격 이상이고, 연속 실패 4회부터 고정 쿨다운으로 넘어간다. 구독자가 없으면 타이머를 재무장하지 않는다.
11. **액션 인스턴스 수가 요청률에 영향을 주지 않는다.** 인스턴스는 공유 서비스를 구독만 하고 자기 네트워크 타이머를 갖지 않는다.
12. **응답 본문을 로그·캐시·디스크에 그대로 쓰지 않는다.** Codex 응답에는 `email`·`user_id`·`account_id` 가 평문으로 들어 있다. Claude 키체인 blob 에는 `claudeAiOauth` 외에 MCP 서버별 clientSecret 이 동거하므로 그 한 필드만 읽는다.
13. **로컬 사용량 로그를 소스로 쓰지 않는다.** `~/.claude/projects/**/*.jsonl` · `~/.codex/sessions/**/*.jsonl` 는 명시적으로 배제한다.
14. **설정 스코프**: 차트·기준·임계값은 **인스턴스**(액션 설정), 갱신 주기는 **전역**. 전역은 **프로바이더 공유 자원만** 둔다 — 폴링 간격은 인스턴스마다 다르면 요청률이 곱해지지만(규칙 11) 임계값은 그런 성질이 없는 판독 정책이다. 토큰류는 어느 쪽에도 두지 않는다 — 액션 설정은 평문이고 프로필 export 에 포함된다.
15. **갱신 주기 하한 60s.** 게이트 2 실측 근거값이다. 그보다 짧게 열면 사용자가 §0 사고를 재현할 수 있으므로 경계에서 clamp 한다.
16. **키에서는 `setTitle` 을 호출하지 않는다.** SVG 안에 이미 퍼센트를 그렸고, 사용자 커스텀 타이틀은 플러그인 출력을 억제한다 — 매니페스트 `UserTitleEnabled: false` 로 원인 자체를 없앴다.
17. **인스턴스 설정을 구독 콜백에 캡처하지 않는다.** 폴링 렌더가 `onWillAppear` 시점 스냅샷을 쓰면 기기·PI 에서 바꾼 차트가 다음 폴링에 조용히 되돌아간다. 현재 설정은 인스턴스별 Map 이 소유하고 `willAppear`·`didReceiveSettings`·기기 조작이 갱신한다.
18. **폴링 간격 변경은 실패 중에 적용하지 않는다.** 백오프·서킷 대기를 새 간격으로 갈아치우면 그 대기가 짧아져 "실패가 요청 빈도를 올리는 경로" 가 다시 열린다.
19. **위험도는 표시값이 아니라 위험으로 판정한다.** 사용량 80% 와 남은양 20% 는 같은 상황이므로 같은 색이어야 한다 — `basis: remaining` 에서 임계를 `100 - x` 로 뒤집는다. 값으로 판정하면 남은양 기준에서 여유가 빨갛게 물든다. **임계값은 인스턴스별 설정**(기본 80%·95%)이고 정규화는 `resolveThresholds()` 가 소유한다 — `risk()` 는 이미 정규화된 값을 받는다.
20. **남은 시간은 폴링 해상도까지만 정확하다.** 렌더 계기가 폴링뿐이라 표시된 카운트다운은 최대 폴링 간격(기본 300s)만큼 낡을 수 있다. 인스턴스별 렌더 타이머를 두면 규칙 11 이 지키는 "인스턴스 수가 요청률에 영향을 주지 않는다" 와 같은 종류의 수명 관리를 화면 갱신에도 새로 들여야 하므로, v1 은 낡음을 수용하고 사용자가 폴링 간격으로 조절한다.
21. **5H 를 모르고 주간만 알면 주간이 주역으로 올라간다.** Codex 는 항상 이 모양이다(규칙 2·3). 승격은 자리 크기가 다른 세 레이아웃(키 도넛·키 바·다이얼 바)에서는 **자리의 이동**이고, 두 셀이 같은 크기인 **다이얼 도넛에서는 강조(색)의 이동**이다 — 자리를 옮기면 5H 가 폴링 사이에 사라질 때 두 셀이 맞바뀌어 눈이 매번 다시 찾아야 한다. 어느 쪽이든 5H 자리는 사라지지 않고 `—` 와 이유(`주간만 제공`)로 남는다 — 규칙 1 이 요구하는 "모름"의 표시다.
22. **캔버스를 칠하지 않는다.** 배경 `rect` 를 그리지 않아 스트림덱 프로필 배경이 그대로 비친다. 대가로 **어두운 배경이 코드 밖의 가정**이 된다 — 판독색(`#f4f4f5`)·조역 흐린 accent·구분선이 모두 그 위에서만 보이므로, 밝은 프로필 배경에서는 게이지를 읽을 수 없다(규칙 19 의 임계 색만 살아남는다).
23. **언어는 설정이 아니라 앱 언어에서 파생한다.** `ko` → 한국어, 나머지는 영어(영어가 폴백). 신호를 하나로 두는 이유는 매니페스트 로컬라이제이션이 같은 신호를 쓰기 때문이다 — OS 로케일을 섞으면 툴팁만 영어인 화면이 생긴다. PI 만 예외로 웹뷰의 `navigator.language` 를 쓴다(sdpi-components 소유, v1 수용).
24. **`RenderOptions.lang` 은 필수다.** `thresholds` 를 필수로 둔 것과 같은 이유다 — 옵셔널이면 호출부가 빠뜨려도 조용히 한 언어로 그려진다. 렌더러는 순수 함수라 `streamDeck.i18n` 을 직접 읽지 않는다(그 접근은 connect 전에 throw 하고, 테스트·프리뷰는 SDK 없이 돈다) — 언어는 `src/i18n.ts` 의 모듈 상태가 갖고 `plugin.ts` 가 connect 직후 심는다.
25. **영문 문구는 번역이 아니라 폭 예산에 맞춰 쓴다.** `notice()` 는 clamp 없이 중앙 정렬로 그려서 키(144px)에서 넘치면 뷰포트가 조용히 잘라낸다 — 제목 15자·힌트 20자(`{cli}` 치환 후)가 상한이고 테스트가 그 불변식을 지킨다.

## Architecture

```
src/plugin.ts                     서비스 생성 → 액션 주입 → connect()
  └─ actions/claude-usage.ts      Encoder + Keypad. 구독만 하고 SVG 를 그린다(타이머 없음)
        ├─ render/gauge.ts        순수 함수 (vm, opts) => SVG 문자열
        └─ usage/service.ts      프로바이더당 1개 — 타이머 · last-good 캐시 · 백오프 · 서킷 · refcount
              └─ usage/claude.ts  2단 읽기
                    ├─ usage/claude-statusline.ts  tier 1: 캐시 JSON (≤90s)
                    ├─ usage/http.ts               tier 2: JSON GET + content-type 가드
                    └─ usage/credentials.ts        플랫폼 분기 1지점 (키체인 / 파일)
        usage/types.ts            LimitsSource · UsageViewModel · assignSlots (유일한 계약)
```

데이터는 한 방향으로 흐르고 단위 변환은 어댑터 안에서 끝난다. 액션과 렌더러는 프로바이더의 단위 관용구를 모른다.

## File Structure

| 경로                              | 역할                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `src/plugin.ts`                   | 진입점. 폴링 간격·stale 상한 상수                                                |
| `src/actions/claude-usage.ts`     | 액션. 구독·SVG 렌더·dedupe. `encodeSvg()` 가 게이트 1 전환점                     |
| `src/render/gauge.ts`             | 순수 렌더러. 4조합 × 슬롯 arity                                                  |
| `src/usage/types.ts`              | 계약 + `assignSlots` (버킷팅·most-binding)                                       |
| `src/usage/service.ts`            | 공유 poller                                                                      |
| `src/usage/claude.ts`             | Claude 어댑터 + `parseUsage`                                                     |
| `src/usage/claude-statusline.ts`  | tier 1 캐시 리더                                                                 |
| `src/usage/http.ts`               | JSON GET, 상태코드→state 매핑, Cloudflare HTML 가드                              |
| `src/usage/credentials.ts`        | 키체인/파일 읽기, JWT `exp` 디코드, 만료 선판정                                  |
| `src/settings.ts`                 | 설정 계약 + 기본값·clamp. 인스턴스/전역 스코프 분리                              |
| `src/i18n.ts`                     | `Lang` · 앱 언어 → 화면 언어 파생 · 모듈 상태(렌더러가 SDK 를 안 읽게 하는 지점) |
| `com.sonky…/ko.json`              | 한국어 매니페스트 오버라이드(액션 UUID 키). 런타임 문구는 여기 없다              |
| `com.sonky…/ui/claude-usage.html` | Property Inspector                                                               |
| `com.sonky…/ui/i18n.js`           | PI 문구 테이블(두 PI 공유) + 도움말 `data-i18n` 워커                             |
| `com.sonky…/vendor/`              | 로컬 vendor 한 `sdpi-components` v4.0.1. 루트 lint·prettier 가 이미 무시         |
| `scripts/statusline-cache.mjs`    | Claude Code statusline 훅. `rate_limits` → 캐시 JSON(원자적) + 상태줄 출력       |
| `fixtures/`                       | 실측 응답 + 실패 케이스. 렌더·파싱 검증을 네트워크 0으로 돌리기 위한 것          |
| `com.sonky.c-ai-usage.sdPlugin/`  | 매니페스트·레이아웃·아이콘. `layouts/usage.json` 은 pixmap 하나로 캔버스 전체    |

## Dependencies

- `@elgato/streamdeck` ^2.1.0 — 유일한 런타임 의존. **네이티브 바이너리 의존이 없다.** 선언 위치는 **루트 [package.json](../package.json)** 이다(빌드 툴체인도 같이) — 이 워크스페이스 `package.json` 에는 `build`/`watch` 스크립트만 있다.
- 게이지는 in-plugin SVG 생성이다. `@napi-rs/canvas` 같은 플랫폼별 네이티브 캔버스를 쓰면 이 저장소가 지키는 self-contained 배포 성질이 깨진다.
- macOS 자격증명은 `/usr/bin/security` shell out(OS 기본 제공). Windows·Linux 는 파일 읽기 — **네이티브 의존이 없다.**
- ⚠ **Windows 는 구현 · 미검증.** 이 저장소는 macOS 에서 작성됐다. 네이티브 의존이 없어 위험은 자격증명 경로(`%USERPROFILE%\.claude\.credentials.json` · `%USERPROFILE%\.codex\auth.json`)에 국한된다.
- PI 는 `sdpi-components` v4.0.1 을 **로컬 vendor** 한다(CDN 아님). ⚠ 이 버전에 `sdpi-item-group` 은 **없다** — 커스텀 엘리먼트 등록 목록으로 확인했다.

## Glossary

| 용어            | 뜻                                                                          |
| --------------- | --------------------------------------------------------------------------- |
| 창(window)      | 사용량이 집계되는 기간. 5시간 롤링 / 주간                                   |
| 슬롯(slot)      | 화면상 고정 자리 2개(5HR·Week). 창이 배정되거나 공란                        |
| tier 1 / tier 2 | statusline 캐시 읽기 / 계정 API 직접 폴링                                   |
| last-good       | 마지막 성공 응답. 429·네트워크 실패 때 나이와 함께 계속 보여준다            |
| most binding    | 같은 버킷의 창 중 utilization 이 가장 높은 것 = 사용자를 실제로 제약하는 창 |
| 게이트 1 / 2    | 실기기 SVG 래스터라이저 확인 / 폴링 간격·UA 실측                            |

## Data Flow

```
setTimeout(interval)
  → ClaudeSource.fetch()
      → tier 1  statusline 캐시 (≤90s)  ──신선─→ slots
      → tier 2  키체인 읽기 → 만료 선판정 → GET /api/oauth/usage
                → content-type 가드 → parseUsage → 창 순회 → assignSlots
  → state==='ok'  ? last-good 갱신 + 다음 tick = interval
                  : 백오프(항상 interval 이상) · soft 실패면 last-good 을 stale 로
  → 구독자에게 emit
      → renderGauge(vm, {surface, chart, basis}) → SVG
      → 직전 SVG 와 같으면 전송 생략
      → 다이얼 setFeedback({canvas}) / 키 setImage()
```
