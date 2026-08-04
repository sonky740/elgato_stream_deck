# c-ai-usage 실행 체크리스트

근거·설계·실측값은 [ai-limits-plan.md](ai-limits-plan.md)에 있다. 여기는 실행 트래커다 — 각 항목은 § 로 플랜을 가리키고 이유를 반복하지 않는다.

**다음에 할 것**: 게이트 1(SVG 래스터라이저 실기기 확인). Phase 1 코드는 다 섰고 헤드리스 Chrome 으로 컴포지션까지 검증했지만, **Stream Deck 의 래스터라이저가 arc path·`<text>`·한글 글리프를 그리는지는 실기기에서만 알 수 있다.** 액션을 다이얼에 올려야 하므로 사용자 조작이 필요하다.

---

## 0. 사고 수습 (§0)

- [x] `streamdeck stop kr.co.postgresql.ai-limits` — 마지막 요청 `01:23:42Z`, 이후 로그 증가 0 · 프로세스 없음으로 검증
- [x] 로그 390 MB 회수 — 삭제 전 비-429 라인 6줄(타임아웃 4 · 503 · socket hang up)만 `~/Desktop/ai-limits-reference/ai-limits-non429-log-lines.txt` 로 보존
- [x] 토큰 예산 회복 확인 — 게이트 2 측정 12회 전부 200(429 0건). hot loop 이전에 7/10 이 429 였던 것과 대조된다

## 결정 (§13)

- [x] 만들 것인가 → **go**. 기존 2개 삭제 후 직접 만든 것으로 대체 (게이트 4)
- [x] 기성품 채택 → 탈락. 소스 레이어도 **직접 작성**, `@lenadweb/ai-limits` 는 서킷브레이커 상수만 참조 (게이트 3)
- [x] 토큰 경로 → 직접 읽기(키체인 / `auth.json`), **refresh 절대 금지**
- [x] 액션 구성 → 프로바이더별 2개 / 서피스 → 다이얼 + 키
- [x] Codex window → 슬롯 2개 고정, 5HR 공란 + Week 만 (§2)
- [x] User-Agent → 자기 UA `c-ai-usage/<version>` (게이트 2 가 흉내내기 근거를 없앰, §4.1)
- [x] 폴링 간격 → **300s** (Claude · Codex 공통, §7 게이트 2)
- [x] Claude 소스 → 2단 읽기: statusline 캐시(≤90s) → 직접 GET (§4.3)
- [x] v1 범위 → Claude · 다이얼 · 도넛 · `used`, PI 없음 (§12 Phase 1)
- [x] 기본값 → `basis: 'used'`, `chart: 'donut'`
- [x] 워크스페이스 / UUID → `c_ai_usage/` · `com.sonky.c-ai-usage`
- [x] 약관 확인 — **Team 좌석은 Commercial Terms 적용**(Claude Code legal 페이지가 명시). Consumer Terms §3 의 봇·스크립트 금지는 이 계정에 **적용되지 않는다** → 초안의 "DECISIVE" 판정은 틀렸다. Commercial Terms 엔 해당 조항이 없다(§7 게이트 4)

---

## Phase 0 — 게이트 + 스캐폴딩 (§7, §10)

### 게이트

- [x] **게이트 2** 폴링 간격 + UA — 15분 유휴 → 60s 간격 6회 × 2블록. **A(CLI UA) 6/6 · B(UA 없음) 6/6, 429 0건.** 측정창 `01:38:45Z~02:03:53Z`
- [x] **게이트 1** SVG 래스터라이저 실기기 확인 — **통과** (§7 게이트 1)
  - [x] 프로브 구현 — `src/render/probe.ts`. 각 SVG 가 자기 단계 번호를 ASCII 로 표시
  - [x] arc path(`A` + `stroke-linecap`) ✅ · 중앙 정렬 `<text>` ✅ · **한글 글리프 ✅**
  - [x] `charset=utf8` data URI 시각 확인. 96회 전송 실패 0건
  - [x] 도넛 설계 유지 확정 — 네이티브 `bar`/`gbar` 폴백 불필요, `MESSAGE` 표 한글 유지
  - [x] 프로브 해제 + 실제 게이지 end-to-end — 로그 `claude usage: loading → ok (5H 69% / WK 30%)`
  - [x] 인코딩 판정 — **raw `<svg>` 문자열은 pixmap 에서 안 그려진다**(빈 화면, 전송 오류 없음). Elgato 스키마 설명과 실제가 불일치. `encodeSvg()` 를 base64 data URI 로 교체
  - [x] **base64 data URI 다이얼 표시 확인 — 잘 보인다.** 출하 형식 확정
  - [ ] ~~키에서 `setImage` 로 반복~~ → 매니페스트가 `Controllers: ["Encoder"]` 뿐이라 지금 불가. Phase 4 로 이월
- [x] `npm run watch -w c-ai-usage` 대신 `streamdeck restart` 로 실기기 반영 확인 (프로브 4회·게이지 1회)

### 워크스페이스 (§10)

- [x] `c_ai_usage/` 생성
- [x] `package.json` — private · `type: module` · watch 에 `streamdeck restart com.sonky.c-ai-usage`
- [x] `tsconfig.json` — `extends: "../tsconfig.base.json"` + include/exclude 만
- [x] `rollup.config.mjs` — `sdPlugin` 상수만 교체
- [x] 자기 `.gitignore` — `*.sdPlugin/bin`, `*.sdPlugin/logs` (워크스페이스별 파일)
- [x] devDependencies 를 media_controller 와 동일하게 + `@elgato/streamdeck` 를 dependencies 로
- [x] 루트 `package.json` `workspaces` 에 추가 → 루트 `npm install` (`node_modules/c-ai-usage` 심링크 확인)
- [x] `manifest.json` — Claude 액션 · `Controllers: ["Encoder"]` · `OS: mac` · `Category: "C AI Usage"`
- [x] `layouts/usage.json` — pixmap 1개가 200x100 전체 (§6 풀캔버스 SVG 척추)
- [x] 플레이스홀더 애셋 10장 — 20/40, 72/144 ×2, 28/56, 256/512. `sips` 로 규격 검증
- [x] `src/plugin.ts` — logger `'info'`(trace 금지, §4.2 PII)
- [x] `src/actions/claude-usage.ts` — 정적 렌더로 layout key ↔ `setFeedback` key 배선만 검증
- [x] `npm run build` (워크스페이스 + 루트 전체) · `npm run lint` · `npm run format:check`
- [x] `streamdeck validate com.sonky.c-ai-usage.sdPlugin` → ✔
- [x] `streamdeck link com.sonky.c-ai-usage.sdPlugin` (1회) — `streamdeck dev` 는 media_controller 로 이미 활성
- [x] Phase 0·1 커밋 — 브랜치 `feat/c-ai-usage` 에 4개 커밋(계획 문서 / 루트 툴링 / 워크스페이스 / CLAUDE.md). main 직접 커밋 대신 브랜치를 썼다

### 기존 플러그인 정리 (§7 게이트 3)

- [x] 삭제 **전에** `bin/` 참조 복사 + 추출 노트 → `~/Desktop/ai-limits-reference/` (`NOTES.md` 에 hot loop 메커니즘 · 키체인 execFile · 401/403 강등 · duration 버킷 · Codex 헤더 · `mostBindingWeekly` · 설정 기본값 전문)
- [ ] `kr.co.postgresql.ai-limits` 삭제
- [ ] `com.statuscheck.codex-usage` 삭제

---

## Phase 1 — v1 출하 (Claude · 다이얼 · 도넛 · `used`) (§12)

### 렌더러 (§6)

- [x] `render/gauge.ts` — 순수 함수 `renderUsage(vm, {surface, chart, basis}) => SVG string`
- [x] 컴포지션 확정: `dial/donut` · `dial/bar` · `key/donut` · `key/bar`, 각각 **두 슬롯 찬 경우 / 5HR 공란인 경우** 두 arity
- [x] viewBox · 요소별 x/y/w/h · 폰트 크기 · stroke 폭을 숫자로 고정 (200x100 과 144x144 는 별개 컴포지션)
- [x] 프리뷰 생성 — `npm test` 가 SVG 64장 + 컨택트시트 `index.html` 을 `preview/` 에 쓴다(헤드리스 Chrome 으로 실제 픽셀 래스터라이즈해 확인). 별도 `scripts/preview` 대신 테스트에 얹었다 — 러너가 이미 TS 를 처리한다
- [x] 공란 슬롯이 "그리다 만 것" 이 아니라 의도된 상태로 읽히는지 확인

### 뷰모델 · 소스 (§4, §5)

- [x] `usage/types.ts` — `LimitsSource` + `UsageViewModel`(`slots: {fiveHour, week}`, `utilization: number | null` 0..100, `resetsAtMs`)
- [x] `usage/credentials.ts` — 플랫폼 분기 1지점. macOS 키체인 `-s "Claude Code-credentials" -a $USER`, **`d.claudeAiOauth` 만** 읽기(`mcpOAuth` 시크릿 동거)
- [x] `usage/claude-statusline.ts` — tier 1. `used_percentage`(0..100) + `resets_at`(**epoch 초**) 정규화
- [x] `usage/claude.ts` — tier 2 직접 GET. `utilization`(float 0..100) + `resets_at`(**ISO 문자열**) 정규화
- [x] window 슬롯을 **열거하지 말고 순회** — 코드네임 슬롯이 계속 추가된다
- [x] ~~`limits[]` 는 구조용으로만~~ → **v1 에서 `limits[]` 를 아예 쓰지 않기로 변경**. int 로 소수점 해상도를 잃고 scoped 항목 `resets_at` 이 null 이라 창 객체만으로 충분하다 (DECISIONS 기록)
- [x] `is_active` 로 렌더 게이팅 **안 함** — 5시간 창이 `false` 로 온다
- [x] duration 버킷으로 슬롯 배정 (`>0 && ≤86400` → 5HR, `≥259200` → Week, 버킷당 first-match-wins). 슬롯 위치로 라벨 금지
- [x] Week 슬롯 = **가장 binding 한 weekly** (utilization 최대). 일반 weekly 가 아니면 라벨에 `scope.model.display_name` 표시 (§2)
- [x] 폴링마다 자격증명 재읽기 — accessToken 수명 ≈ 5시간. **캐시 없음**: 폴링이 300s 간격이라 30s 캐시는 무의미하고 CLI 의 갱신을 늦게 집어올 뿐이다
- [x] token refresh 코드 **부재** 확인

### 서비스 (§5)

- [x] `usage/service.ts` — 프로바이더당 1개. 네트워크 타이머 + last-good 캐시 + `fetchedAtMs`
- [x] 액션 인스턴스는 **구독**만 — 자기 네트워크 타이머 금지 (media_controller 의 1초 폴링 관용구 복사 금지)
- [x] 가시성 refcount — 보이는 인스턴스 0이면 폴링 정지
- [x] 첫 fetch 에 jitter
- [x] 단일 in-flight 가드 — 프로바이더당 동시 요청 1개
- [x] 지수 백오프 + 상한 — **에러가 요청 빈도를 올리는 경로가 없어야 한다** (§5, §0 사고 원인)
- [x] 서킷브레이커 — 연속 실패 4회 → 고정 쿨다운. 재시도 타이머 무조건 재무장 금지
- [x] `expiresAt <= Date.now()` 만료 선판정 — 확실히 실패할 요청을 네트워크에 안 보냄
- [x] 구독 즉시 "로딩" 렌더 — 첫 fetch 이전에도 그릴 것이 있다

### 실패 상태 (§8)

- [x] 상태표 11종 전부 구분되는 렌더 문자열
- [x] 429 를 에러로 취급 안 함 — last-good + staleness 나이
- [x] Cloudflare HTML(403) 을 `JSON.parse` 하지 않음 — `content-type` 선검사
- [x] `{}` 본문을 "0% 사용" 이 아니라 "미권한" 으로
- [x] null window 를 0% 도 100% 남음도 아니게 — `basis: remaining` 변환이 null 에 돌지 않는지 테스트
- [x] stale → 명시적 에러 승격 임계값(권고 30분)

### 테스트 (§11)

- [x] 루트 devDependency 로 vitest 추가
- [x] 픽스처 커밋 — 플랜 §4.1·§4.2 본문에서 복원. Codex 의 `email`/`user_id`/`account_id` 는 `<redacted>` 로 치환해 넣었다(원본은 PII 때문에 삭제됨)
- [x] 실패 상태별 픽스처: null window · `{}` · 429 · Cloudflare HTML · Codex 1-window · Codex 2-window
- [x] `renderUsage` SVG 스냅샷
- [x] `usage/fake.ts` — `C_AI_USAGE_FAKE` 로 선택. `cycle`(전 상태 순회) · `<state>` 고정 · `one`(5HR 공란) · `unknown`(utilization null). 게이트 1 도 이걸로 돌린다
- [x] Claude 라벨·버킷 매핑 단위 테스트 (키 이름 → durationSec → 슬롯). Codex 3계층(`limit_window_seconds`/`window_minutes`/`windowDurationMins`)은 Phase 3
- [x] redaction 테스트 — `src/usage/redaction.test.ts`. 이메일·`sk-ant-o*`·`sk-ant-ort`·JWT·`rt.*`·`Bearer <값>` 6종 패턴이 logger 에 닿지 않음을 실패 경로·예외 경로에서 검증

### statusline 훅 (§4.3)

- [x] 현재 설정 확인 — `settings.json`·`settings.local.json` 둘 다 `statusLine` 키 없음 → **신규 설치**(기존 출력 래핑 불필요)
- [x] statusline 스크립트 작성 — `scripts/statusline-cache.mjs`. stdin `rate_limits` → `~/.claude/c-ai-usage-statusline.json` (tmp+rename 원자적) + 상태줄 출력. **설치는 사용자 결정**(settings.json 변경)
- [x] 플러그인은 **읽기 전용** 접근
- [x] tier 1 → tier 2 폴백 검증 — `src/usage/claude-source.test.ts` (신선하면 네트워크 0, 낡으면 tier 2 값 사용, 파일 없어도 동작)

### 문서

- [x] `c_ai_usage/SPEC.md` — media_controller 섹션 모양(Purpose / Features / Business Rules / Architecture / File Structure)
- [x] Business Rules 에: null≠0 규칙 · duration 라벨 규칙 · 슬롯 2개 고정 계약 · 실패 상태표
- [x] `c_ai_usage/DECISIONS.md` — 날짜·결정·이유·대안 4열. read-only(refresh 금지) · 풀캔버스 SVG · 요구사항 3 (b)절 이탈 · statusline 로컬 파일 이탈 · ToS go/no-go · 재사용 판정
- [x] 루트 `CLAUDE.md` 에 새 워크스페이스 섹션 + gotchas

---

## Phase 2 — Property Inspector (§9)

- [x] 시작 순서 — 서비스(기본 간격) → 액션 등록 → `await connect()` → `getGlobalSettings()` → `setIntervalMs`. 폴링은 구독 시점에 시작하므로 순서 문제가 없다(최악의 경우 첫 1회만 기본 간격)
- [x] `onDidReceiveGlobalSettings` 로 라이브 재설정 + `onDidReceiveSettings` 로 차트·기준 변경 시 즉시 재렌더(폴링 대기 없이)
- [x] 액션별 `PropertyInspectorPath` + HTML — `ui/claude-usage.html`
- [x] `sdpi-components` v4.0.1 을 **`vendor/` 아래로 로컬 vendor**(공식 릴리스 URL 에서 내려받음) (루트 eslint 가 `**/vendor/**`, .prettierignore 가 `**/vendor/` 를 이미 무시 → 보호된 설정 파일 안 건드림)
- [x] `chart`(donut\|bar) · `basis`(used\|remaining) `sdpi-radio` — 기본값 `donut`+`used`(v1 동작과 동일)
- [x] 설정 스코프 분리 — 인스턴스: chart·basis / 전역: 폴링 간격(60~3600s, 경계 clamp). 어느 weekly 는 most-binding 자동 선택이라 설정 불필요
- [x] 토큰류를 **어느 설정에도** 두지 않음 — 키체인/`auth.json` 에서 읽으므로 담을 필요가 없다
- [x] `getSecrets()` 사용 안 함 (읽기 전용 · Marketplace+DRM · deprecated)
- [x] 숫자 설정에 `value-type="number"` 명시 + `resolvePollMs` 가 문자열도 받아 clamp

## Phase 3 — Codex (§4.2)

- [x] `usage/codex.ts` — `GET https://chatgpt.com/backend-api/wham/usage` (라이브 200 확인)
- [x] **명시적 non-default User-Agent** — 자기 UA `c-ai-usage/0.1.0` 로 라이브 요청이 200 + `application/json` (챌린지 없음)
- [x] `content-type` 선검사 → HTML 챌린지를 `blocked` 로 (테스트 포함)
- [x] PII 제거를 파싱 경계 코드 가드로 — `parseUsage` 가 숫자만 뷰모델로 옮긴다. `email` 을 넣은 본문으로 뷰모델에 안 새는지 단정하는 테스트 포함
- [x] `reset_at`(epoch 초) 사용, 드리프트하는 `reset_after_seconds` 아님 — 2026년이 나오는지 단정
- [x] ~~`credits.balance` 가 문자열임을 처리~~ → **해당 없음.** `credits`·`spend_control` 을 읽지 않는다(게이지에 필요한 건 `rate_limit` 뿐). 읽지 않는 필드의 파싱 함정은 만들 이유가 없다
- [x] JWT `exp` 로컬 디코드로 만료 판정 — 만료 시 요청하지 않는지 단정
- [ ] 5HR 공란 컴포지션 실기기 확인 — Codex 액션을 다이얼에 올려야 한다. ⚠ 이 페이즈 완료 후에도 두 숫자가 다 뜨는 건 Claude 뿐(라이브 재확인: `primary` 604800s / `secondary` null)
- [x] Codex 액션 아이콘 애셋 — 플레이스홀더 6장(accent `#10a37f`, 렌더러의 codex 색과 동일)

## Phase 4 — Keypad (§6)

- [ ] 144x144 컴포지션
- [ ] 모든 것을 SVG 안에 그림 — `setTitle` 호출 안 함(퍼센트 위에 겹침)
- [ ] `States[0].Image` 를 데이터 도착 전 fallback 으로 유지
- [ ] 사용자 커스텀 타이틀/이미지가 플러그인 출력을 억제한다는 사실 문서화
- [ ] 매니페스트 `Controllers` 에 `"Keypad"` 추가

## Phase 5 — Windows (§4.1, §4.2)

- [ ] Claude `%USERPROFILE%\.claude\.credentials.json`(`$CLAUDE_CONFIG_DIR` 우선) — 키체인 없음
- [ ] Codex `%USERPROFILE%\.codex\auth.json`
- [ ] `usage/credentials.ts` 한 파일에 격리
- [ ] 매니페스트 `OS` 에 windows 추가
- [ ] Windows 머신이 없으면 `smtc-helper` 처럼 "구현 · 미검증" 으로 출하 표기

---

## 최종 애셋 (전 페이즈 공통)

- [ ] 플레이스홀더 → 실제 아이콘 교체 (기존 아이콘 디자인 프로젝트 계열)
- [ ] 규격: 액션 `Icon` 20/40 · `States[].Image` 72/144 · `Encoder.Icon` 72/144 · `CategoryIcon` 28/56 · 플러그인 `Icon` 256/512. **120x120 만들지 않음**(SD+ HID 해상도이고 SDK 애셋 계약 아님)
