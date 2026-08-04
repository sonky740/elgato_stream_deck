# C AI Usage (Stream Deck + 플러그인)

## Purpose

Claude 구독의 **5시간 창과 주간 창 사용량을 동시에** 다이얼·키에 게이지로 표시한다. 수치는 계정 범위·서버 계산 값만 쓴다 — 여러 기기에서 AI 를 쓰기 때문에 한 기기의 로컬 사용량 로그로는 합산이 성립하지 않는다.

Codex 도 포함한다 — 단 OpenAI 가 2026-07-13 이후 주간 창만 반환하므로 **Codex 의 5HR 슬롯은 공란이 정상**이다. 근거·실측 계약·페이즈 계획은 [../ai-limits-plan.md](../ai-limits-plan.md), 실행 상태는 [../ai-limits-checklist.md](../ai-limits-checklist.md).

## Features

- **Claude Usage** · **Codex Usage** 액션 — 다이얼(터치스트립 200×100) / 키(144×144). 5H · WK 두 게이지 + 퍼센티지. 배관은 `actions/gauge-action.ts` 공통, 프로바이더 차이는 주입된 서비스 뒤에 있다.
- 차트 **도넛 / 가로 바**, 기준 **사용량 / 남은양** — Property Inspector 에서 인스턴스별로 고른다. 기본값은 `donut` + `used`.
- 갱신 주기는 **전역 설정**(60~3600s, 기본 300s) — 프로바이더 공유 자원이라 인스턴스별로 두면 요청률이 곱해진다.
- 2단 읽기: Claude Code statusline 캐시가 신선하면 네트워크 0, 아니면 계정 API 직접 폴링.
- 실패 상태 11종이 서로 구분되는 화면을 갖는다.

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
14. **설정 스코프**: 차트·기준은 **인스턴스**(액션 설정), 갱신 주기는 **전역**. 토큰류는 어느 쪽에도 두지 않는다 — 액션 설정은 평문이고 프로필 export 에 포함된다.
15. **갱신 주기 하한 60s.** 게이트 2 실측 근거값이다. 그보다 짧게 열면 사용자가 §0 사고를 재현할 수 있으므로 경계에서 clamp 한다.
16. **키에서는 `setTitle` 을 호출하지 않는다.** SVG 안에 이미 퍼센트를 그렸고, 사용자 커스텀 타이틀은 플러그인 출력을 억제한다 — 매니페스트 `UserTitleEnabled: false` 로 원인 자체를 없앴다.
17. **폴링 간격 변경은 실패 중에 적용하지 않는다.** 백오프·서킷 대기를 새 간격으로 갈아치우면 그 대기가 짧아져 "실패가 요청 빈도를 올리는 경로" 가 다시 열린다.

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

| 경로                              | 역할                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `src/plugin.ts`                   | 진입점. 폴링 간격·stale 상한 상수                                             |
| `src/actions/claude-usage.ts`     | 액션. 구독·SVG 렌더·dedupe. `encodeSvg()` 가 게이트 1 전환점                  |
| `src/render/gauge.ts`             | 순수 렌더러. 4조합 × 슬롯 arity                                               |
| `src/usage/types.ts`              | 계약 + `assignSlots` (버킷팅·most-binding)                                    |
| `src/usage/service.ts`            | 공유 poller                                                                   |
| `src/usage/claude.ts`             | Claude 어댑터 + `parseUsage`                                                  |
| `src/usage/claude-statusline.ts`  | tier 1 캐시 리더                                                              |
| `src/usage/http.ts`               | JSON GET, 상태코드→state 매핑, Cloudflare HTML 가드                           |
| `src/usage/credentials.ts`        | 키체인/파일 읽기, JWT `exp` 디코드, 만료 선판정                               |
| `src/settings.ts`                 | 설정 계약 + 기본값·clamp. 인스턴스/전역 스코프 분리                           |
| `com.sonky…/ui/claude-usage.html` | Property Inspector                                                            |
| `com.sonky…/vendor/`              | 로컬 vendor 한 `sdpi-components` v4.0.1. 루트 lint·prettier 가 이미 무시      |
| `scripts/statusline-cache.mjs`    | Claude Code statusline 훅. `rate_limits` → 캐시 JSON(원자적) + 상태줄 출력    |
| `fixtures/`                       | 실측 응답 + 실패 케이스. 렌더·파싱 검증을 네트워크 0으로 돌리기 위한 것       |
| `com.sonky.c-ai-usage.sdPlugin/`  | 매니페스트·레이아웃·아이콘. `layouts/usage.json` 은 pixmap 하나로 캔버스 전체 |

## Dependencies

- `@elgato/streamdeck` ^2.1.0 — 유일한 런타임 의존. **네이티브 바이너리 의존이 없다.**
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
| 게이트 1 / 2    | 실기기 SVG 래스터라이저 확인 / 폴링 간격·UA 실측. 계획서 §7                 |

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
