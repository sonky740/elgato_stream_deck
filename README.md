# Stream Deck + 플러그인 모노레포

**Elgato Stream Deck +** 용 플러그인들. 각 플러그인은 자기 디렉토리에서 자기완결적으로 빌드되고, ESLint · Prettier · vitest · tsconfig 는 루트에서 공용으로 가져다 쓴다(npm workspaces).

## 플러그인

그림은 둘 다 **터치스트립(200×100)** 이다. 어두운 배경은 스트림덱 프로필 배경이고, 두 플러그인 모두 캔버스를 칠하지 않는다.

<table>
  <tr>
    <td><img src="media_controller/docs/dial.png" width="200" alt="media_controller 터치스트립 — 앨범아트 + 곡 제목 · 아티스트 · 앨범 3단" /></td>
    <td>
      <b><a href="media_controller/">media_controller</a></b><br />
      OS 미디어 세션으로 현재 재생 곡 표시·제어 (모든 플레이어)<br />
      <sub>macOS 검증 완료 / Windows 미검증</sub>
    </td>
  </tr>
  <tr>
    <td><img src="c_ai_usage/docs/dial-donut.png" width="200" alt="c_ai_usage 터치스트립 — 5시간 창 37% 와 주간 창 26% 도넛 2개" /></td>
    <td>
      <b><a href="c_ai_usage/">c_ai_usage</a></b><br />
      Claude · Codex 구독 사용량 한도를 5시간·주간 두 게이지로 표시<br />
      <sub>macOS 검증 완료 / Windows 미검증</sub>
    </td>
  </tr>
</table>

c_ai_usage 그림은 플러그인이 실제로 만드는 SVG 를 구운 것이다. **media_controller 그림은 재구성이다** — 그 플러그인은 값만 보내고 그리는 건 기기의 레이아웃 렌더러라 뽑아낼 산출물이 없어, [레이아웃 정의](media_controller/com.sonky.media-controller.sdPlugin/layouts/now-playing.json)의 rect·폰트·색으로 다시 그렸다(곡 정보는 자리표시 문자열).

설치·사용·플랫폼별 준비물은 각 플러그인 README 에 있다 — [media_controller/README.md](media_controller/README.md) · [c_ai_usage/README.md](c_ai_usage/README.md).

## 대상 환경

macOS 12+ / Windows 10+, **Stream Deck 앱 7.1+**(매니페스트 `SDKVersion: 3`, `Nodejs.Version: 24`). Node 런타임은 Stream Deck 앱이 번들하므로 로컬 Node 버전과 무관하다.

## 공용 명령 (루트에서)

```bash
npm install          # 1회 — 모든 워크스페이스 의존성 + 공용 devtool
npm run lint         # eslint . (전 워크스페이스)
npm run lint:fix
npm run format       # prettier --write .
npm run format:check
npm run build        # 모든 워크스페이스 빌드
npm test             # vitest run — 루트 하나가 전 워크스페이스의 src/**/*.test.ts 를 돈다
npm run test:watch
```

한 워크스페이스만 다루려면 `-w <package-name>` (`media-controller` · `c-ai-usage`). 플러그인별 `streamdeck` 명령은 해당 디렉토리에서 실행한다.

타입체크는 별도 스크립트가 없다 — `npm run build`(rollup 의 `@rollup/plugin-typescript`)가 겸한다.

## 새 플러그인 추가

1. 루트에 디렉토리를 만들고 루트 [package.json](package.json) 의 `workspaces` 에 추가한다.
2. 워크스페이스 `tsconfig.json` 은 [tsconfig.base.json](tsconfig.base.json) 을 `extends` 하고 자기 `include`/`exclude` 만 둔다. 파일명·위치를 바꾸면 안 된다 — rollup 이 빌드 cwd 의 `tsconfig.json` 을 자동 탐색한다.
3. `exclude` 에 **`src/**/*.test.ts` 를 반드시 넣는다.** 빼면 rollup 의 타입체크가 테스트 파일까지 검사해 vitest 전역(`describe`/`it`)을 못 찾고 빌드가 깨진다.

루트 [eslint.config.mjs](eslint.config.mjs) 와 `.prettierrc.json` 은 `config-protection` 훅 대상이라 편집이 차단된다. 포매팅은 Prettier 에 일임하고 ESLint 는 `eslint-config-prettier` 로 충돌 룰만 끈다.

## 문서 지도

|                                                                                           |                                                                      |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                                                    | 저장소 개요 + **손대기 전에 알아야 할 결합 관계**(플러그인별 gotcha) |
| `<플러그인>/SPEC.md`                                                                      | 계약·비즈니스 규칙 (SSOT)                                            |
| `<플러그인>/DECISIONS.md`                                                                 | 설계 결정과 이유, 검토한 대안                                        |
| [ai-limits-plan.md](ai-limits-plan.md) · [ai-limits-checklist.md](ai-limits-checklist.md) | c_ai_usage 의 근거·실측값과 실행 상태                                |
