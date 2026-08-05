// 루트 ESLint 는 Node 글로벌만 안다(설정은 config-protection 훅 대상이라 파일 하나 때문에 열지
// 않는다) — 이 파일은 PI 웹뷰에서 돌므로 쓰는 글로벌을 여기서 선언한다.
/* global SDPIComponents, document */

/**
 * Property Inspector 문구. 두 PI(claude·codex)가 이 한 테이블을 공유한다.
 *
 * sdpi-components 는 `label`·`<option>` 의 `__MSG_<key>__` 를 여기서 찾는다
 * (`SDPIComponents.i18n.locales`). 언어는 라이브러리가 `navigator.language` 로 잡고 없는 키는
 * `en` 으로 떨어지므로, 지원 언어 8개 중 ko 외에는 전부 영어가 된다.
 *
 * ⚠ `sdpi-components.js` **뒤 · `<body>` 앞**에서 동기 로드해야 한다. 커스텀 엘리먼트가
 * 업그레이드될 때 `locales` 가 이미 있어야 문구가 치환된다 — 늦게 넣으면 `__MSG_…__` 가 그대로
 * 화면에 남는다.
 *
 * ⚠ 키에 점(`.`)을 쓰지 않는다. 룩업이 키를 dotted path 로 훑어 `ko.a['b']` 를 찾으므로 조용히
 * 빈 문자열이 된다. (플러그인 쪽 `streamDeck.i18n.t()` 도 같은 제약이다.)
 *
 * ⚠ 언어 신호가 플러그인과 다르다 — 여기는 웹뷰의 `navigator.language`, 게이지·매니페스트는
 * 스트림덱 앱 언어다. OS 와 앱 언어를 다르게 쓰면 PI 만 다른 언어가 될 수 있다(v1 수용).
 */
SDPIComponents.i18n.locales = {
  ko: {
    chart: '차트',
    donut: '도넛',
    bar: '가로 바',
    basis: '표시 기준',
    used: '사용량',
    remaining: '남은양',
    warnAt: '주의 임계',
    critAt: '위험 임계',
    pct80Recommended: '80% (권장)',
    pct95Recommended: '95% (권장)',
    pollInterval: '갱신 주기',
    min1: '1분',
    min3: '3분',
    min5Recommended: '5분 (권장)',
    min10: '10분',
    min30: '30분',
    hour1: '1시간',
    help: '도움말',
    helpThresholds:
      '<b>주의 임계</b> 이상은 amber, <b>위험 임계</b> 이상은 red 로 그립니다. 남은양 기준에서는 임계가 뒤집혀 <b>남은 20%</b> 와 <b>사용 80%</b> 가 같은 색입니다. 주의 임계를 위험 임계보다 높게 고르면 위험 임계에 맞춰지고 amber 단계가 없어집니다.',
    helpSourceClaude:
      '수치는 <b>Claude 계정에서 직접</b> 읽어옵니다 — 기기별 로컬 기록이 아니라 계정 전체 사용량이므로 여러 기기에서 쓴 양이 합산됩니다.',
    helpSourceCodex:
      '수치는 <b>ChatGPT 계정에서 직접</b> 읽어옵니다 — 기기별 로컬 기록이 아니라 계정 전체 사용량이므로 여러 기기에서 쓴 양이 합산됩니다.',
    helpLoginClaude:
      '이 기기에 <b>Claude Code 로그인</b>이 필요합니다. <b>재로그인 필요</b>가 보이면 Claude Code 를 한 번 실행하면 자동으로 복구됩니다.',
    helpLoginCodex:
      '이 기기에 <b>Codex CLI 로그인</b>이 필요합니다. <b>재로그인 필요</b>가 보이면 터미널에서 <b>codex</b> 를 한 번 실행하면 자동으로 복구됩니다.',
    helpBlank: '빈 칸(<b>—</b>)은 0% 가 아니라 <b>값을 모른다</b>는 뜻입니다.',
    helpCodexWeeklyOnly:
      'OpenAI 가 2026-07-13 이후 주간 창만 반환하므로 <b>5H 칸이 비어 있는 것이 정상</b>입니다. 빈 칸(<b>—</b>)은 0% 가 아니라 <b>값을 모른다</b>는 뜻입니다. 5시간 창이 돌아오면 자동으로 채워집니다.',
  },
  en: {
    chart: 'Chart',
    donut: 'Donut',
    bar: 'Bar',
    basis: 'Basis',
    used: 'Used',
    remaining: 'Remaining',
    warnAt: 'Warn at',
    critAt: 'Critical at',
    pct80Recommended: '80% (recommended)',
    pct95Recommended: '95% (recommended)',
    pollInterval: 'Refresh',
    min1: '1 min',
    min3: '3 min',
    min5Recommended: '5 min (recommended)',
    min10: '10 min',
    min30: '30 min',
    hour1: '1 hour',
    help: 'Help',
    helpThresholds:
      'Values at or above <b>Warn at</b> are drawn amber, at or above <b>Critical at</b> red. On the Remaining basis the thresholds flip, so <b>20% left</b> and <b>80% used</b> share one color. Choosing a warn threshold above the critical one pulls it down to the critical value, which removes the amber step.',
    helpSourceClaude:
      'The numbers are read <b>straight from your Claude account</b> — this is account-wide usage rather than a per-device log, so everything you used on other devices is included.',
    helpSourceCodex:
      'The numbers are read <b>straight from your ChatGPT account</b> — this is account-wide usage rather than a per-device log, so everything you used on other devices is included.',
    helpLoginClaude:
      'This device needs to be <b>logged in to Claude Code</b>. If you see <b>Token expired</b>, running Claude Code once restores it automatically.',
    helpLoginCodex:
      'This device needs to be <b>logged in to the Codex CLI</b>. If you see <b>Token expired</b>, running <b>codex</b> once in a terminal restores it automatically.',
    helpBlank: 'An empty slot (<b>—</b>) means the value is <b>unknown</b>, not 0%.',
    helpCodexWeeklyOnly:
      'OpenAI has returned only the weekly window since 2026-07-13, so an <b>empty 5H slot is normal</b>. An empty slot (<b>—</b>) means the value is <b>unknown</b>, not 0%. If the 5-hour window returns, it fills in on its own.',
  },
};

// 도움말 블록은 sdpi 컴포넌트가 아니라 평범한 `<details>` 라 `__MSG_` 가 닿지 않는다. 같은
// 테이블에서 채운다 — 문구에 `<b>` 강조가 있어 innerHTML 이다(입력은 이 파일뿐이다).
// 키를 못 찾으면 키를 그대로 보여준다(sdpi 의 실패 모양과 같게).
document.addEventListener('DOMContentLoaded', () => {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    el.innerHTML = SDPIComponents.i18n.getMessage(key) || key;
  }
});
