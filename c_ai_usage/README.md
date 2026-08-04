# C AI Usage

Claude · Codex 구독의 **5시간 창과 주간 창 사용량**을 Stream Deck + 의 다이얼·키에 게이지로 띄운다.

수치는 **계정 범위 서버 계산값**만 쓴다 — 로컬 사용량 로그(`~/.claude/projects/**/*.jsonl` 등)는 쓰지 않는다. 여러 기기에서 AI 를 쓰면 한 기기의 로그로는 합산이 성립하지 않기 때문이다.

## 요구사항

|                |                                                                             |
| -------------- | --------------------------------------------------------------------------- |
| Stream Deck 앱 | **7.1+** (매니페스트 `SDKVersion: 3`)                                       |
| 하드웨어       | Stream Deck + (다이얼) 또는 키 있는 아무 모델                               |
| OS             | macOS 12+ / Windows 10+ (⚠ Windows 는 **구현·미검증**)                      |
| 로그인         | Claude 는 **Claude Code**, Codex 는 **Codex CLI** 에서 로그인돼 있어야 한다 |

네이티브 바이너리 의존이 없다. Node 런타임은 Stream Deck 앱이 번들한다(로컬 Node 버전과 무관).

## 설치

Marketplace 에 올린 플러그인이 아니라 로컬 설치다.

```bash
npm install                              # 저장소 루트에서 1회
npm run build -w c-ai-usage

cd c_ai_usage
npx streamdeck dev                                     # 서명 안 된 로컬 플러그인 허용 — 최초 1회
npx streamdeck link com.sonky.c-ai-usage.sdPlugin      # Stream Deck 에 연결 — 최초 1회
```

Stream Deck 앱의 액션 목록에 **C AI Usage** 카테고리가 생기고 `Claude Usage` · `Codex Usage` 두 액션을 다이얼이나 키에 올릴 수 있다.

배포용 패키지가 필요하면 `npx streamdeck pack com.sonky.c-ai-usage.sdPlugin`.

## 컨트롤

| 조작                  | 동작                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| 키 누름               | 차트 순환 (도넛 ↔ 바)                                                   |
| 다이얼 회전           | 회전 **방향**으로 차트 한 칸. 양끝에서 감싸므로 계속 돌리면 계속 바뀐다 |
| 다이얼 누름 · 터치 탭 | 기준 전환 (사용량 ↔ 남은양)                                             |

회전은 400ms leading-edge throttle 이 걸려 있다 — 휙 돌려도 한 칸만 간다. 키는 누름을 차트에 쓰므로 기준 전환은 Property Inspector 에서 한다.

## 설정

**인스턴스별** (액션마다 따로):

- 차트 — 도넛 / 바
- 기준 — 사용량 / 남은양

**전역** (두 프로바이더 공유):

- 갱신 주기 — 1 · 3 · 5 · 10 · 30 · 60분 (기본 5분). 프로바이더 공유 자원이라 인스턴스별로 두면 요청률이 인스턴스 수만큼 곱해진다.

## 화면 읽기

두 창을 같은 크기로 나란히 놓지 않고 **주역 1 + 조역 1** 위계로 그린다. 좁은 캔버스(다이얼 200×100 / 키 144×144)에 같은 크기 숫자 둘을 넣으면 팔 길이에서 둘 다 안 읽힌다.

- **색은 위험도**다. 사용량 80%↑ amber, 95%↑ red. 남은양 기준에서는 임계가 뒤집힌다 — 사용 80% 와 남은 20% 는 같은 상황이므로 같은 색이다.
- **남은 시간**을 창마다 쓴다 — 5H 는 `2h 14m`, 주간은 `3d 4h`.
- **`—` 는 0% 가 아니라 "모름"** 이다. 값을 모르는 창은 트랙만 그린다.
- **5H 를 모르고 주간만 알면 주간이 주역 자리로 올라간다.** Codex 는 2026-07-13 이후 주간 창만 반환하므로 **Codex 의 5H 공란은 정상**이고, 그 자리에 `주간만 제공` 이 남는다.
- **실패하면 게이지를 아예 그리지 않는다.** "여유 있음"과 "플러그인 고장"이 닮으면 분간할 수 없으므로, 상태 제목과 다음 할 일 한 줄만 띄운다 — `로그인 필요` / `Claude Code 에서 로그인` 처럼 10종이 서로 다르다.
- **429 · 네트워크 실패는 화면을 비우지 않는다.** 마지막 성공값을 나이(`23분 전`)와 함께 계속 보여준다 — 인증도 엔드포인트도 정상인 상태이기 때문이다.

## 네트워크 · 자격증명

읽는 곳:

- macOS 키체인 `Claude Code-credentials` (`security find-generic-password`) 또는 `~/.claude/.credentials.json` — `CLAUDE_CONFIG_DIR` 을 따른다
- `~/.codex/auth.json`

호출하는 곳:

- `https://api.anthropic.com/api/oauth/usage`
- `https://chatgpt.com/backend-api/wham/usage`

하지 않는 것:

- **토큰 refresh 를 하지 않는다.** refresh token 이 1회용으로 회전하므로 플러그인이 갱신하면 Claude Code CLI 가 무효 토큰을 들고 남아 로그아웃된다. 만료되면 `재로그인 필요` 를 띄우고, CLI 가 다음 실행에서 갱신하면 다음 폴링에 자동 복구된다.
- **토큰을 어느 설정에도 저장하지 않는다.** 액션 설정은 평문이고 Stream Deck 프로필 export 에 포함된다.
- **응답 본문을 로그에 쓰지 않는다.** Codex 사용량 응답에는 `email` · `user_id` · `account_id` 가 평문으로 들어 있다.
- **실패가 요청 빈도를 올리는 경로를 만들지 않는다.** 실패 시 대기는 항상 폴링 간격 이상이고 연속 4회부터 고정 쿨다운이다.

### statusline 훅 (선택)

Claude Code 가 이미 받아온 사용량을 캐시로 넘겨받아, **코딩 중에는 Claude 쪽 API 호출이 0** 이 된다. 설치하지 않아도 직접 폴링으로 동작한다.

`~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /절대경로/c_ai_usage/scripts/statusline-cache.mjs"
  }
}
```

## 개발

저장소 루트에서:

```bash
npm test                      # 루트 vitest 하나가 전 워크스페이스를 돈다
npm run lint
npm run build -w c-ai-usage
npm run watch -w c-ai-usage   # 변경 감지 빌드 + 저장 시 자동 streamdeck restart
```

이 디렉토리에서:

```bash
npx streamdeck validate com.sonky.c-ai-usage.sdPlugin
node scripts/build-icons.mjs  # 아이콘 16장 재생성 (헤드리스 Chrome)
```

타입체크는 별도 스크립트 없이 `npm run build`(rollup 의 `@rollup/plugin-typescript`)가 겸한다.

게이지는 in-plugin SVG 생성이고 순수 함수(`src/render/gauge.ts`)라 픽스처만으로 전 상태를 검증할 수 있다. `npm test` 가 `preview/index.html` 컨택트시트를 만든다 — 모든 조합을 캔버스 크기 그대로 타일링한 것이고 **레이아웃 판정용**이다. 기기에 올라가는 실제 크기(키는 SD+ HID 해상도 120×120 으로 축소된다)나 래스터라이저의 기능 지원 문제는 여기서 드러나지 않으므로, 그쪽은 `preview/` 의 SVG 를 헤드리스 Chrome 으로 실제 크기에 굽거나 실기기에서 본다.

## 알려진 한계

- **Windows 는 구현·미검증.** 네이티브 의존이 없어 위험은 자격증명 경로에 국한된다.
- **남은 시간은 폴링 해상도까지만 맞다.** 다시 그리는 계기가 폴링뿐이라 카운트다운이 최대 폴링 간격(기본 5분)만큼 낡을 수 있다. 신경 쓰이면 갱신 주기를 줄인다.
- **Codex 는 주간 창만 온다.** 벤더가 5시간 창을 다시 주면 코드 변경 없이 채워진다(창 길이 버킷으로 배정한다).
- 키에서는 커스텀 타이틀을 쓸 수 없다(`UserTitleEnabled: false`) — 사용자 지정 타이틀이 플러그인 출력을 영구히 억제하는 함정을 없앴다.

## 문서

|                                                        |                                 |
| ------------------------------------------------------ | ------------------------------- |
| [SPEC.md](SPEC.md)                                     | 계약·비즈니스 규칙 (SSOT)       |
| [DECISIONS.md](DECISIONS.md)                           | 설계 결정과 이유, 검토한 대안   |
| [../ai-limits-plan.md](../ai-limits-plan.md)           | 근거·실측 계약·페이즈 계획      |
| [../ai-limits-checklist.md](../ai-limits-checklist.md) | 실행 상태                       |
| [../CLAUDE.md](../CLAUDE.md)                           | 손대기 전에 알아야 할 결합 관계 |
