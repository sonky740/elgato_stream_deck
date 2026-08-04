# ai-limits — Claude / Codex 사용량 한도 Stream Deck 플러그인 계획

작성 2026-08-04. 이 문서의 모든 API 계약은 **이 머신에서 실측**했다(바이너리 문자열 + 실제 200 응답). 추측은 `⚠ 미검증`으로 표시한다.

---

## 0. 계획보다 먼저 — 지금 실행 중인 사고

**`kr.co.postgresql.ai-limits` v1.0.3.0 플러그인이 당신의 Claude OAuth 토큰으로 초당 ~15회 요청을 계속 쏘고 있다.**

| 항목      | 실측값                                                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| 요청 속도 | 로그 27,621 bytes / 20초 = **~930 req/min** (2026-08-04 01:13Z 측정)                    |
| 결과      | 100% `ERROR Claude usage refresh failed: Error: Usage endpoint status 429`              |
| 지속 기간 | 최소 2026-07-28 이후 (로그 10개 로테이션)                                               |
| 로그 크기 | `Plugins/kr.co.postgresql.ai-limits.sdPlugin/logs` = **389 MB**                         |
| 백오프    | 없음. 번들에 `backoff`·`cooldown` 문자열 0건. 429 는 `reject(new Error(...))` 로만 처리 |

세 가지 실질 피해:

1. **계정 리스크.** `/api/oauth/usage` 의 레이트리밋은 **access token 단위**다. Anthropic 은 자동화 접근에 대해 "사전 통보 없이" 조치할 수 있다고 명시한다. 구독 OAuth 토큰으로 지속 ~15 req/s 는 가장 나쁜 프로파일이다.
2. **당신의 `claude /usage` 가 이미 망가져 있을 가능성이 높다.** 같은 토큰의 예산을 이 플러그인이 다 태우고 있다.
3. **이 계획의 측정값을 오염시켰다.** 이 리서치가 잡은 429 빈도 수치는 전부 이 hot loop 와 동시에 측정되어 폐기했다(§7 참조).

```bash
streamdeck stop kr.co.postgresql.ai-limits
# 로그 회수: rm -rf "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/kr.co.postgresql.ai-limits.sdPlugin/logs"/*.log
```

**정지 완료 2026-08-04** — 마지막 요청 `01:23:42Z`, 이후 로그 증가 0 · 프로세스 없음. 이후 §7 게이트 2 측정이 가능해졌고, 그 결과가 여기 적힌 429 수치들이 **전부 이 hot loop 탓**이었음을 확증했다(UA 유/무 각 6회 전부 200).

---

## 1. 스코프 — net-new 가 아니다

이 머신에 **이미 두 개**가 설치·실행 중이다.

| 플러그인                      | 버전     | 상태                                                                                    |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `kr.co.postgresql.ai-limits`  | 1.0.3.0  | Claude+Codex, 다이얼+키. **§0 의 429 루프**                                             |
| `com.statuscheck.codex-usage` | 0.1.11.0 | Codex 전용. `logs/` 비어 있음(정상 동작 추정). 폴링 `Math.max(15, refreshSeconds)*1000` |

그리고 마켓플레이스에 거의 동일 스코프의 오픈소스가 있다:

- **`lenadweb/stream-deck-ai-limits`** (MIT, [Marketplace](https://marketplace.elgato.com/product/ai-usage-limits-b78ef6c4-0165-4bf2-8ba8-889f723e915f)) — 6 프로바이더(Claude, Codex, Antigravity, Gemini CLI, MiniMax, OpenRouter), Keypad+Encoder, 프로바이더당 액션 1개. 소스 레이어가 별도 npm 패키지 `@lenadweb/ai-limits` 로 분리돼 있다. 저장소 구조가 이 저장소와 거의 같다(rollup, @elgato/streamdeck v2, tsconfig node20, watch 시 streamdeck restart).
- 폴링 15분, 프로바이더 캐시 30초, 429 서킷브레이커(4 retry → 연속 4회 429 시 60초 쿨다운).

**차별점은 렌더링이다.** 요구사항 1(Week+5HR 동시), 2(사용량/남은양), 4(도넛/바)는 전부 그리기 문제고, 위험한 부분(자격증명 읽기, 429 서킷브레이커, 토큰 수명)은 이미 남이 풀어놨다.

권장 프레이밍: **소스 레이어는 빌려오고, 렌더러는 직접 만든다.**

- 확인해야 할 단 하나의 블로커: `@lenadweb/ai-limits` 는 **토큰 refresh 를 수행한다** — §4 의 read-only 원칙과 정면충돌. refresh 를 끌 수 있는지가 채택 여부를 가른다(코드 확인 가능한 질문, 추측 아님).
- 끌 수 없다면: 서킷브레이커 상수만 참조하고 소스 레이어는 직접 작성(§4 대로면 200줄 미만).

`DECISIONS.md` 에 기록할 항목이다.

---

## 2. 요구사항 대비 검증된 현실

| #   | 요구사항                            | 판정                                                                                                         |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Week + 5HR 동시 표시, 차트+퍼센티지 | **Claude 충족 / Codex 부분** — 슬롯 2개 고정, 5HR 은 공란(결정됨, 아래)                                      |
| 2   | 사용량 ↔ 남은양 옵션                | 충족. 단 **퍼센트 도메인 전용** — 절대 토큰 수는 어느 엔드포인트도 주지 않는다. `남은양 = 100 − utilization` |
| 3   | 로컬에서 가져오지 않는다            | **의도 충족, 문자 위반** — §3                                                                                |
| 4   | 도넛 ↔ 가로 바 옵션                 | 충족. 도넛은 SVG pixmap(스키마 문서화됨), 바는 네이티브 `bar`/`gbar` 또는 같은 SVG                           |

### 요구사항 1 이 Codex 에서 안 되는 이유

Codex 는 **2026-07-13 이후 window 를 1개만 반환한다.** 두 경로에서 독립 확인:

- 로컬 rollout 타임라인 10 세션(07/13→07/31): `primary.window_minutes = 10080`(7일), `secondary = null` — 매번.
- 실측 HTTP 200: `primary_window.limit_window_seconds = 604800`, `secondary_window: null`.

같은 계정에서 shape 가 두 번 뒤집혔다: 03/13 까지 weekly-only → 03/13~07/10 5h+weekly → 07/13 부터 weekly-only. **5h 창이 돌아온다는 가정으로 설계하지 않는다.**

**결정됨(2026-08-04)**: **슬롯 2개(5HR / Week)를 고정하고, 채울 데이터가 없는 슬롯은 공란으로 그린다.** OpenAI 가 5h 정책을 되살릴 시점이 미지이므로, 창이 돌아오면 코드 변경 없이 채워지는 쪽을 택한다.

풀캔버스 SVG 를 매번 다시 그리는 설계(§6)라서 공란 슬롯은 공짜다 — layout item 을 조건부로 만들 필요가 없다(`type`/`key`/`rect` 는 런타임 변경 불가 — `api/layout.d.ts:27` `Omit<T,"key"|"rect"|"type">`).

**슬롯 배정은 duration 버킷으로 한다** — 응답의 슬롯 순서를 쓰지 않는다:

| 슬롯           | 조건                                                  | 없을 때 |
| -------------- | ----------------------------------------------------- | ------- |
| 5HR            | `durationSec ≤ 86400` (24h)                           | 공란    |
| Week           | `durationSec ≥ 259200` (3d)                           | 공란    |
| 그 외 duration | 두 고정 슬롯 어디에도 넣지 않는다. v1 은 무시(로그만) | —       |

임계값 근거: 정상 동작 중인 `com.statuscheck.codex-usage` 가 같은 방식을 쓴다 — `FIVE_HOUR_MAX_SECONDS = 24*60*60`, `WEEKLY_MIN_SECONDS = 3*24*60*60`, 버킷당 first-match-wins, `seconds > 0` 가드(0/누락이 5HR 로 잘못 들어가는 것 방지). 정확히 300분/10080분을 비교하지 않고 범위로 잡는 이유는 벤더가 창 길이를 조정해도 라벨이 안 깨지게 하기 위해서다 — 반대로 `kr.co.postgresql.ai-limits` 는 `FIVE_HOUR_MINUTES = 300` / `WEEKLY_MINUTES = 10080` 정확 매칭이라 그때 깨진다.

**Week 슬롯에 어느 weekly 창을 넣나 — 가장 binding 한 것.** `seven_day` 를 하드코딩하지 않는다. 여러 weekly 창(`seven_day`, `seven_day_opus`, `seven_day_sonnet`, `weekly_scoped` …) 중 **utilization 이 가장 높은 것**을 고르고, 그게 일반 weekly 가 아니면 라벨에 scope 명(`scope.model.display_name`)을 표시한다. 근거: `seven_day` 26% · `seven_day_opus` 80% 상황에서 사용자의 실제 제약은 후자다. `ai-limits` 의 `mostBindingWeekly(json)` 이 같은 판단을 한다 — 이 부분은 채용할 만하다.

**공란은 0% 가 아니다.** 공란 슬롯은 §5 의 `utilization: null` 렌더 상태(빈 링/빈 바 + `—`)를 그대로 쓴다. 0% 로 그리면 "여유 만점" 으로 읽히고, `basis: 'remaining'` 에서는 `100 − null` 이 **"100% 남음"** 으로 표시되는 최악의 오표시가 된다.

### 슬롯 위치로 라벨을 붙이면 100% 버그

`primary` 슬롯은 03/13~07/10 에 5시간 창, 07/13 부터 주간 창을 담았다 — 같은 계정. **라벨은 항상 duration 필드에서 파생한다.**

| 레이어               | 필드명                 | 단위            |
| -------------------- | ---------------------- | --------------- |
| Codex HTTP wire      | `limit_window_seconds` | 초 (604800)     |
| Codex rollout JSONL  | `window_minutes`       | 분 (300, 10080) |
| Codex app-server RPC | `windowDurationMins`   | 분              |

`windowDurationMins` 는 `window_minutes` 의 camelCase 가 **아니다**. 잘못 찾으면 `undefined` → 조용히 엉뚱한 창을 그린다. 레이어별 라벨 매핑 단위 테스트를 둔다.

---

## 3. 요구사항 3 — 문자 vs 의도

두 절로 쪼개서 기록한다.

- **(a) 표시되는 숫자는 계정 범위·서버 계산이다 — 충족.** 로컬 사용량 로그를 절대 파싱하지 않는다. `~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/*.jsonl` 는 **명시적으로 소스에서 배제**한다(잘 알려진 로컬 도구들이 여기서 틀린다 — 로컬 window 경계와 utilization 이 서버 진실과 측정 가능하게 어긋난다).
- **(b) 자격증명은 기기별로 로컬에서 읽는다 — 불가피.** 두 엔드포인트 모두 credential-gated 이고 credential 은 로컬에만 있다. `DECISIONS.md` 에 수용된 이탈로 기록한다.

결정됨(v1): **직접 읽기.** Stream Deck 이 붙은 기기에 Claude Code / Codex 로그인이 있어야 한다.

나중 확장 seam(같은 `LimitsSource` 인터페이스 뒤): 이미 CLI 가 돌고 있는 워크스테이션 1대가 캐시된 JSON 요약을 Tailscale 로 publish. **VPS·Cloudflare Worker 는 불가** — headless Linux/데이터센터에서 Claude 토큰 refresh 는 Cloudflare WAF 에 403/만성 429 로 막힌다(anthropic 이 NOT_PLANNED 로 닫은 리포트). publisher 는 실제 워크스테이션이어야 하고, **refresh 는 그 한 대만** 해야 한다(회전하는 refresh token 을 둘이 경쟁하면 서로를 무효화한다).

---

## 4. 데이터 소스 계약 (실측)

### 4.1 Claude

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <claudeAiOauth.accessToken>
anthropic-beta: oauth-2025-04-20
Content-Type: application/json
User-Agent: c-ai-usage/<version>
```

헤더 필요성: `Authorization` 만으로도 200 이 온다. 나머지는 CLI 패리티로 보낸다 — 비용 0.

**UA — 자기 UA 로 확정 2026-08-04** (`c-ai-usage/<version>`).

경위: 사용자가 CLI UA 흉내내기를 승인했으나, 게이트 2 측정이 그 근거를 없앴다 — **UA 유/무 각 6회(60초 간격) 전부 200, 429 0건**(§7). UA 는 레이트리밋 버킷을 고르지 않는다. 이득이 0 이므로 ToS 축에서 방어 가능성만 낮추는 흉내내기를 하지 않는다.

- ⚠ 커뮤니티에서 "429 회피에 결정적"이라 보고된 `claude-code/<version>` 은 바이너리상 `getMCPUserAgent` 로 **MCP/SSE 전송 전용**이다. usage 경로가 쓰는 게 아니다 — 그 보고 자체가 잘못된 경로를 본 것이다.
- 참고로 usage 경로가 실제 쓰는 UA 는 `cTe()` = `claude-cli/<VERSION> (external, cli)`. 나중에 UA 가 다시 문제로 보이면 이 값이 패리티 후보다(하드코딩 금지 — 설치본에서 런타임 판독).

실측 응답(top-level 17키):

```jsonc
{
  "five_hour": { "utilization": 12.0, "resets_at": "2026-08-04T04:49:59.233339+00:00",
                 "limit_dollars": null, "used_dollars": null, "remaining_dollars": null },
  "seven_day": { "utilization": 23.0, "resets_at": "2026-08-07T01:59:59.233360+00:00", … },

  // 이 계정에서 전부 null — 같은 window 모양으로 추정되나 필드셋 미관측
  "seven_day_opus": null, "seven_day_sonnet": null, "seven_day_oauth_apps": null,
  "seven_day_cowork": null, "seven_day_omelette": null, "tangelo": null,
  "iguana_necktie": null, "omelette_promotional": null, "nimbus_quill": null,
  "cinder_cove": null, "amber_ladder": null,

  "limits": [
    { "kind": "session",       "group": "session", "percent": 12, "severity": "normal",
      "resets_at": "…", "scope": null, "is_active": false },
    { "kind": "weekly_all",    "group": "weekly",  "percent": 23, "…": "…", "is_active": true },
    { "kind": "weekly_scoped", "group": "weekly",  "percent": 0,  "resets_at": null,
      "scope": { "model": { "id": null, "display_name": "Fable" } }, "is_active": false }
  ],
  "extra_usage": { "is_enabled": false, "monthly_limit": null, "used_credits": null, … },
  "spend": { "used": { "amount_minor": 0, "currency": "USD", "exponent": 2 }, … },
  "member_dashboard_available": false
}
```

**단위**: `utilization` = **float 0..100**. `resets_at` = **ISO-8601 문자열**(마이크로초 + `+00:00`). 0..1 해석은 죽었다(12.0, 23.0).

파싱 규칙:

- **CLI 의 zod 스키마(6 슬롯)·allowlist(8키)는 wire 보다 뒤처져 있다.** 파싱 계약으로 쓰지 않는다. window 모양 슬롯을 **열거하지 말고 순회**한다 — 코드네임 슬롯이 계속 추가된다.
- `limits[]` 는 **구조**용으로만 읽는다(kind/group/scope/severity). **수치와 `resets_at` 은 window 객체에서 가져온다** — `limits[].percent` 는 int(`12`)인데 `utilization` 은 float(`12.0`)이고, `weekly_scoped.resets_at` 은 null 인데 window 객체는 타임스탬프를 갖는다.
- **`is_active` 로 렌더를 게이팅하지 않는다.** 실측: 5시간 창(`session`, 12% 사용)이 `is_active: false`, `weekly_all` 이 `true`. "active 만 그린다" 규칙은 사용자가 가장 보고 싶은 숫자를 숨긴다. 의미가 확정될 때까지 쓰지 않는다.
- 모델 스코프 창의 라벨은 `scope.model.display_name` 을 **서버가 준 대로** 쓴다. 이 계정의 값은 Opus 도 Sonnet 도 아닌 `"Fable"` 이다. 하드코딩 금지.
- 돈 표현이 **3종**이다: `extra_usage`(`monthly_limit`/`used_credits`/`currency`/`decimal_places`), `spend.used`(minor units — `amount_minor / 10^exponent`), Codex `credits.balance`(**문자열** `"0"`). v1 은 셋 다 안 쓴다.
- 빈 응답 `{}` 는 "사용량 0" 이 **아니라** "미권한"이다 — CLI 자체가 토큰에 `user:inference` + `user:profile` 둘 다 없으면 `{}` 로 단락한다.

**자격증명 (macOS)**

```bash
security find-generic-password -s "Claude Code-credentials" -a "$USER" -w
```

- 비대화식 성공 확인(GUI 프롬프트 없음, exit 0, 3564 bytes). `~/.claude/.credentials.json` 은 이 머신에 없다 — 키체인이 유일 소스.
- 반환 JSON: `claudeAiOauth.{accessToken(sk-ant-oat01…), refreshToken, expiresAt(epoch **ms**), refreshTokenExpiresAt, scopes[5], subscriptionType, rateLimitTier}`.
- **`d.claudeAiOauth` 만 읽는다.** 같은 blob 에 `mcpOAuth` 의 서버별 clientId/clientSecret 이 동거한다. 전체 blob 을 덤프·로그하면 안 된다.
- `execFile("security", […], { timeout: 5000 })` + `if (err || !stdout) return null`. 렌더를 동기 키체인 호출로 블록하지 않는다.
- Windows: `%USERPROFILE%\.claude\.credentials.json`(`$CLAUDE_CONFIG_DIR` 우선). env `CLAUDE_CODE_OAUTH_TOKEN` 오버라이드 존재.

**토큰 수명 — 설계를 가르는 제약**

- accessToken 잔여수명 실측 **≈ 5.3시간**. 시작 시 1회 읽는 구현은 몇 시간 뒤 조용히 401 이 되고 Stream Deck 재시작까지 고장 난 채 남는다.
- → **폴링마다 키체인을 다시 읽는다**(짧은 캐시 30초). 메모리에 토큰을 붙들지 않는다.
- → **refresh 는 절대 호출하지 않는다.** refresh token 은 회전(1회용)한다. 플러그인이 독립 refresh 하면 Claude Code CLI 가 무효 토큰을 들고 남아 **로그아웃된다**. 만료 시 "재로그인 필요" 를 그리고, CLI 가 다음 실행 때 갱신하면 다음 폴링에서 self-heal 한다. 이 UX 를 사용자가 받아들이는 것이 read-only 설계의 전제다.

### 4.2 Codex

```
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <tokens.access_token>
ChatGPT-Account-Id: <tokens.account_id>
User-Agent: <반드시 명시. 기본값이면 안 된다>
```

- 경로 주의: `/backend-api/api/codex/usage` 는 **404**. `/wham/usage` 가 first-party 경로다(openai/codex 의 Rust: `PathStyle::ChatGptApi => format!("{}/wham/usage", base_url)`). `/backend-api/codex/usage` 도 200 을 주지만 CLI 가 쓰는 건 `/wham/usage` 다.
- `ChatGPT-Account-Id` 는 실측상 **없어도 200**. CLI 패리티로 보낸다.
- **Cloudflare 봇 게이트 — 코딩 요구사항으로 취급한다.** HTTP/2 curl → 403 + HTML 챌린지(3/3). undici 기본 UA 의 `fetch` → 챌린지 HTML. 명시 UA 를 준 `fetch`/python urllib → 200. Node 에서 403 HTML 을 `res.json()` 하면 throw 되고, 자연스러운 catch 는 인증 실패와 구분 불가한 일반 에러를 그린다. → **`content-type` 을 파싱 전에 검사**하고 챌린지를 별도 상태로 보고한다. (설치된 정상 동작 플러그인은 UA 를 리터럴 `"codex-cli"` 로 준다 — 실제 CLI UA 를 흉내낼 필요는 없다.)

실측 응답:

```jsonc
{
  "plan_type": "plus",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 18,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 373567,
      "reset_at": 1786178120,
    },
    "secondary_window": null,
  },
  "credits": {
    "has_credits": false,
    "unlimited": false,
    "overage_limit_reached": false,
    "balance": "0", // ⚠ 문자열, number 아님
    "approx_local_messages": [0, 0],
    "approx_cloud_messages": [0, 0],
  },
  "code_review_rate_limit": null,
  "additional_rate_limits": null,
  "spend_control": { "reached": false, "individual_limit": null },
  "rate_limit_reached_type": null,
  "promo": null,
  "rate_limit_reset_credits": { "available_count": 2, "applicable_available_count": 0 },

  "user_id": "…",
  "account_id": "…",
  "email": "…", // ⚠ PII (평문)
}
```

위 두 블록(§4.1 Claude, §4.2 Codex)이 실측 200 응답 전문이다 — 값은 이 계정·이 시점 기준. `secondary_window`, `code_review_rate_limit`, `additional_rate_limits`, `promo`, `spend_control.individual_limit` 는 이 Plus 계정에서 모두 null 이라 **필드셋이 관측되지 않았다**(⚠ 미검증).

**단위**: `used_percent` = **int 0..100**. `reset_at` = **epoch 초**. `reset_after_seconds` 는 호출마다 감소(373567 → 373363)하는 상대값이니 **`reset_at` 을 쓴다**.

- ⚠ **PII**: `email`/`user_id`/`account_id` 가 평문으로 온다. **응답 본문을 그대로 로그·캐시·디스크에 쓰면 이메일이 유출된다.** 파싱 경계에서 코드 가드로 제거한다(주석 아님). 이 리서치 과정에서 실제로 한 번 유출됐다 — 주의 문구로는 못 막는다는 증거다.
- 자격증명: `~/.codex/auth.json`(`$CODEX_HOME`), mode 0600 → `{auth_mode, last_refresh, OPENAI_API_KEY, tokens:{access_token, account_id, id_token, refresh_token}}`. **만료 필드가 없다** — access_token JWT 의 `exp`(epoch 초)를 로컬 디코드하는 게 유일한 신호. 실측 잔여 **≈ 5.2일**(총 ~10일). Claude 와 비대칭.
- Windows: `%USERPROFILE%\.codex\auth.json`.

### 4.3 대안 소스 (v1 에 안 쓰지만 기록)

| 소스                                                                     | 단위                                      | 왜 안 쓰나                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `anthropic-ratelimit-unified-{5h,7d}-{utilization,reset}` 응답 헤더      | utilization **0..1 분수**, reset epoch 초 | `/v1/messages` 호출이 필요 = **측정하려는 quota 를 소비**한다. ToS 상 오히려 더 명확한 "자동화 접근". 단, `setup-token`(user:inference 만)으로도 되는 유일한 경로                                                              |
| Claude Code statusline stdin (`rate_limits.*.used_percentage`, v2.1.80+) | 0..100, resets_at **epoch 초**            | **유일하게 공식 문서화된** 구독 5h/주간 표면. 네트워크 0, 자격증명 취급 0, ToS 리스크 최소. 그러나 claude.ai 구독자 + 세션의 첫 API 응답 이후에만 채워지고, 세션이 없으면 즉시 stale → 상시 다이얼에 부적합. Codex 대응물 없음 |
| Anthropic Admin API (usage/cost)                                         | —                                         | **구독 계정에 불가.** Console org 의 Admin key 필요, 개인 계정 미지원. 게다가 토큰/비용 집계만 주고 5h/주간 window utilization 은 절대 안 준다                                                                                 |
| OpenAI platform Costs/Usage API                                          | —                                         | org API key 스코프. ChatGPT Plus/Pro 플랜엔 없다                                                                                                                                                                               |

### 결정됨 2026-08-04 — Claude 는 2단 읽기로 간다

```
tier 1  statusline 캐시가 신선하면(≤ 90s) 그걸 쓴다        네트워크 0, ToS 축 회피
tier 2  stale 이면 §4.1 직접 폴링                          게이트 2 가 정한 간격 준수
어느 쪽이든 fetchedAtMs 를 뷰모델에 실어 staleness 를 표시한다
```

Codex 는 대응물이 없어 직접 폴링만이다.

구현 요소:

- **statusline 훅**: Claude Code 설정에 statusline 커맨드를 붙이고, 그 스크립트가 stdin 의 `rate_limits` 를 고정 경로 JSON 으로 덮어쓴다. 선례 `bozdemir/claude-usage-widget` 의 `statusline_cache_path` 와 같은 형태.
  - 캐시 경로는 이 저장소 밖(예: `~/.claude/ai-limits-cache.json`)에 두고, 플러그인은 **읽기 전용**으로만 접근한다.
  - 스크립트는 **기존 statusline 출력을 깨지 않아야 한다** — 이미 statusline 을 쓰고 있으면 기존 커맨드를 감싸서 stdin 을 tee 하는 형태로 붙인다(사용자 환경 확인 필요).
- **단위 변환 주의**: statusline 페이로드는 `rate_limits.{five_hour,seven_day}.used_percentage`(0..100) + `resets_at`(**epoch 초**)다. §4.1 의 HTTP 응답(`utilization` float 0..100 + **ISO 문자열**)과 필드명·시간 포맷이 **둘 다 다르다**. §5 뷰모델로 정규화하는 어댑터를 tier 별로 따로 둔다.
- **⚠ tier 1 의 근본 한계**: `rate_limits` 는 claude.ai 구독자 + **세션의 첫 API 응답 이후**에만 채워진다. Claude Code 를 안 쓰고 있으면 캐시는 계속 stale 이고, 상시 켜둔 다이얼에서는 tier 2 가 사실상 주 경로가 된다. tier 1 은 "코딩 중일 때 폴링을 0으로 만드는 최적화" 로 보는 게 정확하다 — 폴링을 없애주는 게 아니다.
- **⚠ 로컬 파일이지만 요구사항 3 을 위반하지 않는다**: 숫자는 Claude Code 가 서버에서 받아온 계정 범위 값이다(§3 의 (a) 절 충족). 로컬 사용량 로그 파싱이 아니다. 그래도 (b) 절과 같은 성격의 이탈이니 `DECISIONS.md` 에 함께 기록한다.

---

## 5. 아키텍처

```
src/plugin.ts                        서비스 2개 생성 → 액션 2개에 주입 → connect() → 전역설정 로드 → 폴링 시작
  ├─ actions/claude-limits.ts        Encoder + Keypad
  ├─ actions/codex-limits.ts         Encoder + Keypad
  │     └─ (공통 베이스: 타이머/구독/dedupe/렌더 배관)
  ├─ usage/service.ts                프로바이더당 1개. 네트워크 타이머 + last-good 캐시 + 서킷브레이커 + 가시성 refcount
  ├─ usage/claude.ts                 LimitsSource 구현 — 2단 읽기(statusline 캐시 → 직접 GET, §4.3)
  ├─ usage/claude-statusline.ts      tier 1: 캐시 JSON 읽기 + epoch 초/used_percentage 정규화
  ├─ usage/codex.ts                  LimitsSource 구현 (auth.json + GET + UA/content-type 가드 + PII 제거)
  ├─ usage/credentials.ts            플랫폼 분기 1지점 (darwin: keychain / win32: 파일)
  ├─ usage/types.ts                  LimitsSource 인터페이스 + UsageViewModel (컨슈머가 의존하는 유일한 계약)
  └─ render/gauge.ts                 순수 함수: (vm, opts) => SVG string
```

### media_controller 의 폴링 관용구를 복사하면 안 된다

`media_controller` 는 인스턴스마다 `setInterval` 1초로 `getNowPlaying()` 을 호출한다 — 거기선 stream 프로세스가 밀어넣은 로컬 캐시를 읽을 뿐이라 안전하다. 여기서는 **매 폴링이 레이트리밋된 HTTPS 요청**이고, 인스턴스 N개면 요청률이 N배가 된다. 다이얼 2개 올리는 순간 영구 429 가 되고, 사용자에겐 설계 오류가 아니라 고장으로 보인다.

**역전시킨다**: 프로바이더당 공유 poller 1개가 네트워크 타이머와 `{value, fetchedAtMs}` 캐시를 소유하고, 액션 인스턴스는 **구독**해서 변경 시에만 렌더한다. 인스턴스는 자기 네트워크 타이머를 갖지 않는다.

### §0 사고의 메커니즘 — 이 네 가지를 반드시 어긴 게 원인이다

`ai-limits` 번들을 뜯어 확인한 구조(전문: `~/Desktop/ai-limits-reference/NOTES.md`):

```js
createUsageStore({ ttlMs: 25_000, errorRetryMs: 5_000, hasData: (d) => Boolean(d.fiveHour || d.weekly) })

function scheduleRetry() {
  if (cache && hasData(cache.data)) return;   // 429 는 hasData=false → 항상 통과
  if (retryTimer) return;
  retryTimer = setTimeout(() => refresh(...), errorRetryMs);   // 무조건 재무장
}
```

429 는 `hasData` 가 false 인 값을 캐시하므로 재시도 타이머가 **매번 다시 걸린다**. 여기에 프로바이더 6개 × 액션 인스턴스별 구독이 곱해져 ~930 req/min 이 됐다. 즉 **에러 상태가 정상 상태보다 더 자주 요청하는 구조**다.

강제할 규칙 넷:

1. **단일 in-flight 가드** — 프로바이더당 동시 요청 1개.
2. **지수 백오프 + 상한.** 에러가 요청 빈도를 **올리는** 경로가 존재해선 안 된다.
3. **연속 실패 N회 → 서킷 오픈**(고정 쿨다운). 재시도 타이머를 무조건 재무장하지 않는다.
4. **액션 인스턴스 수가 요청률에 영향을 주지 않는다** — 구독만, 자기 타이머 금지.

`expiresAt <= Date.now()` 만료 **선판정**은 채용할 만하다 — 확실히 실패할 요청을 네트워크에 내보내지 않는다.

- `onWillAppear`/`onWillDisappear` 로 가시성 refcount → 보이는 인스턴스가 0이면 폴링 정지.
- 첫 fetch 에 jitter → 두 프로바이더가 동시에 쏘지 않게.
- 서킷브레이커: 연속 4회 429 → 60초 쿨다운(lenadweb 의 실제 출하값).
- 프로바이더당 서비스를 **분리**한다 — Claude 의 429 가 Codex 를 멈추지 않게.

### 시작 순서 (전역설정 비동기 문제)

`media_controller` 는 모듈 스코프에서 동기 생성 후 주입한다 — 그 컨트롤러는 설정이 필요 없어서 가능했다. usage 서비스는 전역설정(폴링 간격 등)이 필요하고 `getGlobalSettings()` 는 `connect()` 이후에만 된다.

```
서비스 생성(기본값, 폴링 미시작) → 액션 등록 → connect()
  → await getGlobalSettings() → 서비스 설정 → 폴링 시작
onDidReceiveGlobalSettings → 라이브 재설정
```

첫 fetch 가 resolve 되기 전까지 액션은 명시적 "로딩" 상태를 그린다.

### 내부 뷰모델 (정규화 경계)

단위 관용구가 4종이라(§4) 어댑터 안에서만 변환한다.

```ts
type UsageWindow = {
  id: string; // 'five_hour' | 'seven_day' | 'weekly_scoped:Fable' …
  label: string; // duration 에서 파생: '5H' | 'Week' | …
  durationSec: number | null;
  utilization: number | null; // 0..100. null = 미지 (0 이 아니다)
  resetsAtMs: number | null; // epoch ms
};
type UsageViewModel = {
  provider: 'claude' | 'codex';
  // 고정 2 슬롯. 데이터가 없으면 null → 공란 렌더 (§2). 배정은 duration 버킷으로.
  slots: { fiveHour: UsageWindow | null; week: UsageWindow | null };
  fetchedAtMs: number;
  state:
    | 'ok'
    | 'stale'
    | 'no-credential'
    | 'expired'
    | 'revoked'
    | 'throttled'
    | 'network'
    | 'shape-changed'
    | 'blocked';
};
```

**`utilization: number | null` 을 끝까지 유지한다.** 요구사항 2 의 "남은양" 에서 null 에 `100 − utilization` 을 적용하면 **"100% 남음"** 이 나온다 — 진실은 "모름"인데 자신 있게 최댓값을 표시하는, 이 설계에서 가장 위험한 정합성 버그다. null 은 전용 렌더 상태(`—` 또는 빈 차트)를 갖고, used→remaining 변환은 null 에 절대 돌지 않는다.

---

## 6. 렌더링

### 결론: 풀캔버스 SVG 하나가 척추

다이얼은 200x100 캔버스 전체를 덮는 `pixmap` item **하나**, 키는 같은 생성기를 `setImage` 에 먹인다. 두 차트 타입은 한 순수 함수 안의 분기가 된다.

```ts
renderGauge(vm: UsageViewModel, opts: {
  surface: 'dial' | 'key';
  chart: 'donut' | 'bar';
  basis: 'used' | 'remaining';
}): string   // SVG
```

이 선택으로 사라지는 문제들: bar-vs-native 논쟁, 겹치는 rect 의 zOrder 퍼즐, `setFeedbackLayout` 왕복, 그리고 **공란 슬롯 문제**(전체를 매번 다시 그리므로 슬롯을 비우는 게 공짜다 — §2).

지불하는 비용: Property Inspector 를 통한 네이티브 폰트/색 제어와 `"title"` 키 text item 을 포기한다. 그리고 SVG 래스터라이저 리스크(§7 게이트 1).

근거 — Elgato 자체 스키마가 pixmap `value` 에 "an SVG `string`" 을 명시하고, 워크드 예시가 **base64 SVG data URI** 다(디코드 확인). 키의 `setImage` 도 동일 3형식(플러그인 상대 경로 / base64 data URI / raw SVG)을 문서화한다. SVG 는 권장 포맷으로 문서에 적혀 있다. → 네이티브 바이너리 의존 0, canvas 라이브러리 0, 이 저장소의 self-contained 성질 유지.

### 검증된 표면 제약

| 항목                   | 값                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 다이얼 레이아웃 캔버스 | **200 × 100** per encoder. `rect: [x, y, w, h]`, x/w ≤ 200, y/h ≤ 100                                                                                         |
| SD+ 터치스트립 전체    | 800 × 100 (다이얼 4개)                                                                                                                                        |
| 키 애셋 계약           | `States[].Image` 72×72 + 144×144(@2x), `Encoder.Icon` 72/144, `Actions[].Icon` 20/40, 플러그인 `Icon` 256/512, `CategoryIcon` 28/56. 매니페스트에 확장자 생략 |
| layout item type       | `bar` \| `gbar` \| `pixmap` \| `text` — 이 4개뿐                                                                                                              |
| `bar`/`gbar` value     | number, 기본 range 0..100(`range:{min,max}` 로 변경 가능). `subtype` 0..4 = Rectangle/DoubleRectangle/Trapezoid/DoubleTrapezoid/**Groove(기본)**              |
| 런타임 불변            | item 의 `type`/`key`/`rect` — 바를 도넛으로 morph 할 수 없다                                                                                                  |
| `setFeedbackLayout`    | **다이얼 전용.** KeyAction 엔 `setFeedback` 도 `setFeedbackLayout` 도 없다                                                                                    |
| 렌더 우선순위          | 사용자 지정 > 런타임(setImage/setTitle) > 매니페스트 기본. **사용자가 커스텀 타이틀/이미지를 넣으면 플러그인 출력이 무시된다**                                |
| 업데이트 레이트리밋    | Elgato 가 문서화한 것 없음. 이미지/base64 최대 길이도 문서화 없음                                                                                             |

키에서는 **모든 것을 SVG 안에 그리고 `setTitle` 을 호출하지 않는다**(호출하면 퍼센트 위에 텍스트가 겹친다). `States[0].Image` 는 데이터 도착 전 fallback 으로 남긴다.

**200x100 과 144x144 는 별개 컴포지션이다** — 2:1 과 1:1 이라 스케일 재사용하면 찌그러지거나 잘린다.

### Phase 1 산출물: 커밋된 컴포지션 4종

`dial/donut`, `dial/bar`, `key/donut`, `key/bar` 각각에 대해 viewBox, 요소별 x/y/w/h, 폰트 크기, stroke 폭을 숫자로 확정한다. 각각 **두 슬롯 다 찬 경우(Claude)와 5HR 공란인 경우(Codex 현재)** 를 함께 그린다 — 공란이 "그리다 만 것" 이 아니라 의도된 상태로 읽혀야 한다. 네트워크 코드를 쓰기 전에 SVG 를 파일로 떨어뜨려 실제 픽셀 크기로 보고 가독성을 검증한다 — 요구사항 1 의 "200x100 에서 읽힌다"를 확인할 유일한 방법이다.

### 카운트다운은 v1 에서 뺀다

200x100 에 차트 2개 + 퍼센트 2개 + 프로바이더 라벨을 넣으면 자리가 없다. 더 중요하게, 째는 카운트다운은 **두 번째 시계**를 도입해 매초 수 KB SVG 를 재전송하게 만든다 — dedupe 가 막으려던 비용 그 자체다. 넣는다면 fetch tick 과 분리된 **1분 단위** 렌더 tick 으로. 그리고 ⚠ `seven_day.resets_at` 은 신뢰할 수 없다: 11일 관측에서 utilization 이 ~72시간마다 0으로 떨어지는데 `resets_at` 은 계속 1주 뒤를 보고했다.

---

## 7. Phase 0 게이트 — 코드 전에 닫아야 하는 것

### 게이트 1: SVG 래스터라이저 충실도 (도넛 설계를 죽일 수 있다)

pixmap/setImage 안의 SVG 래스터라이저가 `stroke-dasharray`(= 도넛 호를 그리는 방법)와 중앙 정렬 `<text>`(폰트 가용성)를 실제로 존중하는지 **문서화된 곳이 없다.**

버리는 다이얼 액션 1개 + 풀캔버스 pixmap item 1개로, 2초 간격 `setFeedback` 3회:

1. raw `<svg …>` 문자열
2. `data:image/svg+xml;base64,…`
3. `data:image/svg+xml;charset=utf8,<svg …>` ← 어디에도 문서화 안 됨. 의존하지 않는다

테스트 SVG 는 `stroke-dasharray` 호 **와** 중앙 `<text>` 를 반드시 포함한다. 키에서 `setImage` 로 반복.

**실패 시 fallback**: 네이티브 `bar`/`gbar` + text item 으로 가고 도넛 옵션을 드롭한다(요구사항 4 축소 → 사용자 결정 필요).

### 게이트 2: 폴링 간격 + UA — ✅ 완료 2026-08-04

hot loop 정지 후 15분 유휴 → 60초 간격 6회 × 2블록(UA 유/무), 두 블록 사이 15분 유휴. 측정창 `01:38:45Z ~ 02:03:53Z`, 총 12 요청.

| 블록                                     | 결과                           |
| ---------------------------------------- | ------------------------------ |
| A — `claude-cli/2.1.221 (external, cli)` | `200 200 200 200 200 200`      |
| B — UA 없음                              | `200 200 200 200 200 200`      |
| 429                                      | **0건**. `Retry-After` 도 없음 |

세 가지가 확정됐다:

1. **UA 는 레이트리밋 버킷을 고르지 않는다.** UA 유/무가 동일 결과다 → 자기 UA 로 간다(§4.1). 커뮤니티의 "UA 가 결정적" 보고는 usage 경로가 아닌 MCP 전송 UA 를 본 것이다.
2. **60초 폴링이 통과한다.** 이전 리서치의 "7/10 이 429" 는 전부 §0 hot loop 탓이었고, 이제 대조군이 있다.
3. **lenadweb 의 900s 는 과보수다.** 답습할 근거가 없어졌다.

⚠ 표본의 한계: 블록당 6분/6회다. **시간 단위 지속 가능성의 증거가 아니다.** 이 다이얼이 60초 해상도를 필요로 하지도 않으므로 측정 최솟값을 그대로 쓰지 않는다.

**확정 2026-08-04 — 폴링 간격 300s (Claude · Codex 공통).**

- 측정된 60s 의 5배 여유. Claude Code 자체의 usage 캐시 재기록 간격(300000ms)과도 일치한다.
- statusline tier(§4.3)가 코딩 중에는 이 폴링을 0으로 만든다 — 실제 요청은 Claude Code 를 안 쓰는 동안에만 발생한다.
- Codex 도 같은 값이고, 이건 전이가 아니라 **독립 근거가 있다**: 정상 동작 중인 `com.statuscheck.codex-usage` 의 기본 `refreshSeconds` 가 **정확히 300** 이고 그 `logs/` 가 비어 있다(에러 0건). 300s 가 Codex 에서 실제로 문제 없이 도는 값이라는 실증이다.
  - ⚠ 정정: 이전 초안은 "codex-usage 가 15s floor 로 폴링" 이라 적었는데 **틀렸다.** `15` 는 `clampNumber(raw.refreshSeconds, 300, 15, 3600)` 의 하한이자 `Math.max(15, …)` 방어값일 뿐이고 기본값은 300 이다. 15s 가 견뎠다는 증거는 없다.
- 참고용 타 구현 관측값: 30s(ai-limits 캐시 TTL), 120s(onWatch), 180s(Darhkfox), 900s(lenadweb). 문서화된 한도는 어디에도 없다.

### 게이트 3: 재사용 판정

**사용자 결정 2026-08-04**: 설치된 `kr.co.postgresql.ai-limits` · `com.statuscheck.codex-usage` 를 **삭제하고 직접 만든 것으로 대체**한다. 따라서 "기성품을 그냥 쓴다" 는 탈락.

남은 하위 질문: 자기 플러그인 안에서 소스 레이어를 **`@lenadweb/ai-limits`(MIT) 의존으로 가져올지, 직접 쓸지.**

- 권고: **직접 쓴다.** §4 에서 계약(엔드포인트·헤더·단위·자격증명 경로·만료 처리)이 전부 실측으로 확정됐고, 그 위에서 소스 레이어는 프로바이더당 100줄 남짓이다. 반면 `@lenadweb/ai-limits` 는 **토큰 refresh 를 수행**해 §4.1 의 read-only 원칙과 정면충돌한다 — 끌 수 있는지 확인하는 비용이 직접 쓰는 비용과 비슷하다.
- 참조로만 쓸 것: 429 서킷브레이커 상수(4 retry / 연속 4회 → 60초 쿨다운), 폴링 900s.

⚠ **삭제 전에 두 플러그인 번들을 어딘가로 복사해 둔다.** 이 계획이 인용하는 검증된 구현 디테일이 그 안에만 있다: duration 버킷 임계값(`FIVE_HOUR_MAX_SECONDS = 24h`, `WEEKLY_MIN_SECONDS = 3d`), 키체인 `execFile("security", …, {timeout: 5000})` 패턴, 401/403 → `"Open Claude Code"` 강등 처리, Codex UA 리터럴 `"codex-cli"`, 15s 폴링이 견딘 사례.

```bash
P="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins"
mkdir -p ~/Desktop/ai-limits-reference
cp -R "$P/kr.co.postgresql.ai-limits.sdPlugin/bin" ~/Desktop/ai-limits-reference/ai-limits-bin
cp -R "$P/com.statuscheck.codex-usage.sdPlugin/bin" ~/Desktop/ai-limits-reference/codex-usage-bin
```

### 게이트 4: ToS — ✅ 확인 완료 2026-08-04

**정정: 이 계획의 초안이 틀렸다.** 초안은 Consumer Terms §3("automated or non-human means" 금지)을 "DECISIVE" 라고 적었는데, **그 문서는 이 계정을 규율하지 않는다.**

1차 출처 확인 결과:

| 문서                                                                             | 적용 범위 (verbatim)                                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Consumer Terms](https://www.anthropic.com/legal/consumer-terms)                 | "Claude.ai, Claude Pro, and other products and services that we may offer for **individuals**" — Team·Enterprise·API 는 명시적 제외 |
| [Commercial Terms](https://www.anthropic.com/legal/commercial-terms)             | "Anthropic API keys and any other Anthropic offerings that references these Terms"                                                  |
| [Claude Code legal 페이지](https://code.claude.com/docs/en/legal-and-compliance) | "**Commercial Terms** - for **Team**, Enterprise, and Claude API users" / "**Consumer Terms** - for Free, Pro, and Max users"       |

이 계정의 credential 은 `subscriptionType: "team"` + `organizationUuid` 이고 usage 응답에 `member_dashboard_available` 이 있다 → **Commercial Terms 가 적용된다.**

따라서:

- **Consumer Terms §3 의 봇·스크립트 금지 조항은 이 계정에 적용되지 않는다.** 초안이 결정적이라고 본 근거가 사라졌다.
- Commercial Terms 에는 봇·스크립트·스크레이핑 조항이 **없다.** 제한은 D.4 뿐이다 — "access the Services to build a competing product or service, including to train competing AI models or resell the Services" 와 "reverse engineer or duplicate the Services". 자기 사용량 숫자를 읽는 것은 둘 중 어느 것도 아니다.
- Claude Code legal 페이지의 서드파티 조항은 "**on behalf of their users**" 를 대상으로 하고, 그 문장이 열거하는 것은 "Free, Pro, or Max plan credentials" 다 — 개인용 플러그인에도, Team 좌석에도 해당하지 않는다.

**남는 잔여 리스크 (여전히 0 이 아니다)**:

- 같은 페이지가 OAuth 를 "intended exclusively for purchasers of Claude Free, Pro, Max, **Team**, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and **other native Anthropic applications**" 라고 한다. Stream Deck 플러그인은 native Anthropic application 이 아니다 — 이게 남는 유일한 실질 긴장이다.
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so **without prior notice**."
- ⚠ Claude Code usage-tracker Mac 앱 개발자가 밴됐다는 2차 보고가 있다(1차 확인 불가). 널리 인용되는 "Agent SDK 포함 다른 제품에서 OAuth 사용은 ToS 위반" 문장은 언론 인용이고 legal 페이지 본문에 verbatim 으로 **없다**.
- §4.3 의 statusline tier 1 은 이 긴장까지 회피한다 — 요청을 **Claude Code 자신**이 하고(= ordinary use of Claude Code), 플러그인은 그 결과 파일만 읽는다.

**사용자 결정 2026-08-04: go.** 기존 플러그인 2개를 삭제하고 직접 만든 것으로 대체한다. 따라서 아래 완화 조건이 **설계 제약으로 확정**된다.

- 게이트 2 가 정한 간격보다 빠르게 폴링하지 않는다.
- 공격적으로 캐시하고, 보이는 인스턴스가 0이면 폴링하지 않는다(가시성 refcount, §5).
- 배포하지 않는다 — 개인·로컬 전용. Marketplace 공개는 별개 결정이며 §7 의 "타인의 요청 라우팅" 조항에 다시 걸린다.
- 서킷브레이커 없는 구현을 절대 출하하지 않는다 — §0 이 그 결과다.
- 약관 확인 완료(위) — Commercial Terms 적용이고 봇·스크립트 금지 조항이 없다. 판정이 완화됐으므로 go 결정을 되돌릴 이유는 없다. 다만 "native Anthropic application 이 아니다" 는 긴장은 남으므로 위 완화 조건을 유지한다.

---

## 8. 실패 상태 표

각 상태는 **구분 가능한 렌더 문자열**을 가져야 한다. 그렇지 않으면 사용자가 "quota 여유 있음" 과 "플러그인 고장" 을 구별할 수 없다. 두 상태는 특히 기만적이다: **429 는 에러가 아니고**(같은 순간 `/api/oauth/profile` 이 200 이었다 — 인증·엔드포인트 모두 정상), **chatgpt.com 의 Cloudflare 챌린지는 403 + HTML** 이라 `JSON.parse` 가 엉뚱한 메시지로 throw 된다.

| 상태          | 감지                                                   | 렌더                                                     |
| ------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| no-credential | 키체인 miss / `auth.json` 없음                         | `로그인 필요`                                            |
| expired       | `expiresAt` 과거 / Codex JWT `exp` 과거                | `재로그인 필요`                                          |
| 401           | HTTP 401                                               | credential 재읽기 후 1회 재시도 → 실패면 `재로그인 필요` |
| revoked       | 403 + body 에 "OAuth token has been revoked"           | `재인증 필요`                                            |
| scope 부족    | Claude 403 (setup-token 은 `user:profile` 이 없어 403) | `권한 부족`                                              |
| 미권한        | 200 이지만 body `{}`                                   | `권한 없음` (0% 아님)                                    |
| throttled     | 429                                                    | **last-good 값 + staleness 나이**. 에러 아님             |
| blocked       | 403 + `content-type` 이 HTML / body 가 `<` 로 시작     | `차단됨 (CF)` — 절대 JSON.parse 하지 않는다              |
| network       | fetch reject / timeout                                 | last-good + 나이                                         |
| shape-changed | 알려진 키가 없음                                       | `형식 변경`                                              |
| null window   | `utilization === null`                                 | `—` 또는 빈 차트. **0% 도 100% 남음도 아니다**           |

stale 이 명시적 에러로 승격되는 나이 임계값도 정한다(권고: 30분).

---

## 9. 설정 분리 (틀리면 토큰이 유출된다)

- **액션 설정 = 평문이고 프로필 export 에 포함된다.** 디스크 확인: `~/Library/Application Support/com.elgato.StreamDeck/ProfilesV3/<profile>.sdProfile/Profiles/<page>/manifest.json` 에 다른 플러그인들의 설정이 읽히는 JSON 으로 들어 있다. Elgato 도 "included when exporting Stream Deck profiles" 라고 명시한다.
- **전역 설정은 그 트리 어디에도 JSON 파일로 없다**(비-Plugins 파일 전수 열거로 확인). macOS 키체인 백엔드로 **추정**(⚠ `com.elgato.StreamDeck.<plugin-uuid>` generic-password 항목 관측, 확정 테스트는 미실시).

| 스코프              | 항목                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 인스턴스(액션 설정) | `chartType`(donut\|bar), `basis`(used\|remaining), 어느 weekly window 를 2번째 차트에 쓸지 |
| 전역                | 폴링 간격, 수동 토큰 오버라이드(있다면), 릴레이 URL(Phase 확장)                            |

- 토큰류는 **절대 액션 설정에 두지 않는다**. `<sdpi-password setting="token" global>`.
- `getSecrets()` 는 쓰지 않는다: 읽기 전용(`setSecrets` 없음), 작성자 배포 시크릿용, Marketplace + DRM 필요, **deprecated + 제거 예정**.
- 솔직한 잔여 리스크: 전역 설정은 프로필 export 유출과 캐주얼 파일 탐색을 막지만, **그 머신의 사용자 본인에게는 열려 있다**(Elgato 문서: "users can access them").

### Property Inspector — 이 저장소엔 선례가 없다

`media_controller` 는 `PropertyInspectorPath` 도 `ui/` 도 없다. 요구사항 2·4 가 둘 다 PI 주도라 PI 는 선택이 아니다.

- `sdpi-components` v4 를 **로컬 vendor** 한다(Elgato 가 CDN 을 비권장, 이 저장소의 self-contained 제약도 금지). ~55KB, Lit 인라인. Elgato 자체 플러그인들이 그렇게 한다.
- 배치는 `vendor/` 경로 아래로 — 루트 `eslint.config.mjs` 가 이미 `**/vendor/**` 를, `.prettierignore` 가 `**/vendor/` 를 무시한다. **보호된 설정 파일을 건드릴 필요가 없다**(`config-protection` 훅 회피).
- 컨트롤: `sdpi-select` 또는 `sdpi-radio`(chartType), `sdpi-radio`(basis), `sdpi-password global`(토큰). `value-type` 기본값이 `'string'` 이니 숫자 설정엔 명시한다.

---

## 10. 워크스페이스 추가 체크리스트

깨진 새 워크스페이스는 **루트 빌드**(`npm run build --workspaces --if-present`)를 깬다. 몇 항목은 에러가 아니라 조용한 실패다.

1. `c_ai_usage/` 생성
2. `package.json` — private, `type: module`, 자기 `build`/`watch`(watch 의 `streamdeck restart` 에 **새 UUID**)
3. `tsconfig.json` — `extends: "../tsconfig.base.json"` + 자기 `include`/`exclude` 만. ⚠ base 를 extends 하지 않으면 base 의 `"types": ["node"]` 를 놓쳐 hoist 된 `@types/node` 가 해석되지 않고 `process`/`Buffer` TS 에러가 쏟아진다
4. `rollup.config.mjs` — 복사 후 `sdPlugin` 상수만 교체. ⚠ rollup 은 빌드 cwd 의 `tsconfig.json` 을 자동 탐색한다 — 파일명/위치를 바꾸면 안 된다
5. **자기 `.gitignore`** — `media_controller` 것 복사(`*.sdPlugin/bin`, `*.sdPlugin/logs`). 이 파일은 워크스페이스별이다. `*.sdPlugin/vendor/` 는 **의도적으로 커밋**한다
6. devDependencies 를 `media_controller` 와 동일하게(`@elgato/cli`, rollup + 4 플러그인, typescript, `@types/node`, tslib) + `@elgato/streamdeck` 를 dependencies 로
7. 루트 `package.json` `workspaces` 에 추가 → 루트에서 `npm install`
8. 플레이스홀더 아이콘 애셋을 먼저 넣는다 — `streamdeck validate` 는 선언된 이미지가 없으면 **첫 빌드부터 실패**한다. 필요 세트: `Actions[].Icon` 20/40, `States[].Image` 72/144, `Encoder.Icon` 72/144, `CategoryIcon` 28/56, 플러그인 `Icon` 256/512. **120x120 을 만들지 않는다** — 그건 SD+ HID 하드웨어 해상도이고 SDK 애셋 계약이 아니다
9. `streamdeck link <new-uuid>.sdPlugin` (1회) → `streamdeck validate` → `npm run watch -w ai-limits`
10. `SPEC.md` / `DECISIONS.md` — `media_controller` 의 섹션 모양(Purpose / Features / Business Rules / Architecture / File Structure, DECISIONS 는 날짜·결정·이유·대안 4열 표)
11. 루트 `CLAUDE.md` 에 새 워크스페이스 섹션 + gotchas

**로깅**: `streamDeck.logger.setLevel('trace')` 를 복사하지 않는다(`'info'`/`'warn'`). 응답 본문을 절대 로그하지 않는다 — status, 키 목록, 정규화된 뷰모델만. redaction 헬퍼 + "이메일/토큰 모양 문자열이 logger 에 도달하지 않는다" 테스트를 둔다.

---

## 11. 테스트 (이 저장소엔 테스트 인프라가 전무하다)

타입체크가 `npm run build` 에 얹혀 있고 러너·스크립트·픽스처가 없다. 그런데 이 플러그인의 핵심 리스크가 바로 렌더링·파싱 로직이고, 그건 레이트리밋된 라이브 엔드포인트로 반복 검증할 수 없다.

1. **픽스처를 새로 캡처해 커밋한다.** 이 리서치의 원본 응답 파일은 PII(Codex `email`/`user_id`)를 담고 있어 삭제했다 — 남아 있는 것은 **이 문서 §4.1·§4.2 의 본문**뿐이다. 거기서 복원하거나 §0 정리 후 1회 재캡처한다. PII 제거는 캡처 스크립트 안에서 한다. 추가로 실패 상태별 픽스처: null window, `{}` 미권한, 429 envelope, Cloudflare HTML(403), Codex 1-window, Codex 2-window(과거 shape — rollout 로그에서 복원 가능)
2. `renderGauge` 를 **순수 픽스처→문자열** 로 유지하고 SVG 출력을 스냅샷
3. `scripts/preview` — 픽스처별 SVG 를 실제 픽셀 크기로 디스크에 떨어뜨려 가독성 확인
4. `FakeUsageSource` — 같은 인터페이스, env var 로 선택. 모든 실패 상태를 네트워크 0으로 온디바이스 재현
5. 러너: 루트 devDependency 로 **vitest** 하나 (TS 실행을 손으로 엮지 않는다)

---

## 12. 페이즈

자연스러워 보이는 "소스 레이어부터" 순서는 **거꾸로**다 — 설계를 죽일 수 있는 두 미지를 마지막에 둔다.

| Phase | 내용                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0** | 게이트 1(SVG 충실도 spike) · 게이트 2(폴링/UA 재측정, §0 정리 후) · 게이트 3(재사용 판정) · 게이트 4(ToS go/no-go) · 워크스페이스 스캐폴딩 + 플레이스홀더 애셋으로 `streamdeck validate` 통과                                                    |
| **1** | **v1 출하**(범위 확정 2026-08-04): Claude only, 다이얼 only, 두 window, **도넛 only, `used` only**. 픽스처 주도 순수 렌더러 + 공유 poller(캐시·stale 렌더·§8 전체 상태표) + Claude 2단 읽기(§4.3) + SPEC/DECISIONS. **PI 없음** — 옵션은 Phase 2 |
| **2** | Property Inspector → 요구사항 2(used/remaining) + 요구사항 4(donut/bar). 기본값 **`used` + `donut`** (v1 동작과 동일 = 업그레이드 시 화면이 안 바뀐다)                                                                                           |
| **3** | Codex — **5HR 슬롯 공란** 컴포지션 포함(§2 결정). ⚠ 이 페이즈 완료 후에도 실제로 두 숫자가 다 뜨는 건 Claude 뿐이다. OpenAI 가 5h 창을 복구하면 duration 버킷 배정이 자동으로 채운다 — 코드 변경 없음. Phase 3 을 "Codex 완료" 로 읽지 않는다    |
| **4** | Keypad 144x144 컴포지션                                                                                                                                                                                                                          |
| **5** | Windows 자격증명 경로(Claude `%USERPROFILE%\.claude\.credentials.json` — 키체인 없음 / Codex `%USERPROFILE%\.codex\auth.json`), `usage/credentials.ts` 한 파일에 격리. Windows 머신이 없으면 기존 `smtc-helper` 처럼 "구현·미검증" 으로 출하     |

---

## 13. 결정 현황

### 확정 (2026-08-04)

| 결정                   | 값                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| hot-loop 플러그인 정지 | 완료. 마지막 요청 `01:23:42Z`, 이후 로그 증가 0 · 프로세스 없음                                       |
| 만들 것인가 (게이트 4) | **go.** 기존 플러그인 2개 삭제 → 직접 만든 것으로 대체. §7 게이트 4 의 완화 조건이 설계 제약으로 확정 |
| 기성품 채택 (게이트 3) | 탈락. 하위 질문(소스 레이어 의존 vs 직접)만 남음                                                      |
| 토큰 경로              | 직접 읽기 v1 (키체인 / `auth.json`), refresh 절대 금지                                                |
| 액션 구성              | 프로바이더별 액션 2개                                                                                 |
| 서피스                 | 다이얼 + 키 둘 다                                                                                     |
| Codex window           | 슬롯 2개 고정, 5HR 공란 + Week 만 (§2)                                                                |
| 워크스페이스 / UUID    | `c_ai_usage/` · `com.sonky.c-ai-usage` · 액션 `.claude` / `.codex`                                    |
| 소스 레이어            | **직접 쓴다.** `@lenadweb/ai-limits` 는 참조만(서킷브레이커 상수)                                     |
| User-Agent             | **자기 UA `c-ai-usage/<version>`.** 게이트 2 가 UA 무관을 실측 → 흉내내기 근거 소멸 (§4.1)            |
| 폴링 간격              | **300s** (Claude · Codex 공통). 측정된 60s 의 5배 여유 (§7 게이트 2)                                  |
| Claude 소스            | **2단 읽기** — statusline 캐시(≤90s) → 직접 GET (§4.3)                                                |
| v1 범위                | **좁혀서 먼저** — Claude·다이얼·도넛·`used`, PI 없음 (§12 Phase 1)                                    |
| 기본값                 | `basis: 'used'`, `chart: 'donut'`                                                                     |

### 진행 완료

- **게이트 2** ✅ — UA 무관 + 60s 통과 실측 (§7).
- **Phase 0 스캐폴딩** ✅ — `c_ai_usage/` 워크스페이스, 매니페스트(Claude 액션 · Encoder only · mac only), `layouts/usage.json`(풀캔버스 pixmap 1개), 플레이스홀더 애셋 10장(규격 검증), 루트 `workspaces` 등록. `streamdeck validate` ✔ · 루트 build/lint/format ✔.
  - 스캐폴드 액션은 정적 이미지를 렌더한다 — layout key ↔ `setFeedback` key 결합을 SVG 래스터라이저 리스크와 분리해 검증하기 위한 의도적 선택. 게이트 1 은 `value` 만 교체한다.

### 대기 중

1. **조건부** — 게이트 1(SVG 래스터라이저)이 `stroke-dasharray` 호와 중앙 `<text>` 를 못 그리면 도넛을 포기하고 네이티브 `bar`/`gbar` 만 갈지. 스파이크 결과 나온 뒤 판단(§7 게이트 1).
2. ~~**statusline 훅 설치 방식**~~ → **해소 2026-08-04.** `~/.claude/settings.json` · `settings.local.json` 둘 다 `statusLine` 키가 없다(존재하는 키: settings.json = advisorModel/effortLevel/enabledPlugins/extraKnownMarketplaces/hooks/permissions/skip\*/tui, settings.local.json = env/permissions). **기존 출력을 감쌀 필요 없이 신규 설치**한다 — 래핑 분기를 설계에서 뺀다.
3. **약관 확인** — Team 좌석에 Consumer Terms §3 이 적용되는지. 판정이 바뀌면 §7 게이트 4 결정을 재검토(§7).
