import { existsSync } from 'node:fs';

/**
 * 게이트 1 — Stream Deck SVG 래스터라이저 실기기 확인용 프로브.
 *
 * Elgato 스키마는 pixmap `value` 와 `setImage` 가 raw SVG 문자열·base64 data URI 를 받는다고
 * 명시하지만, **어떤 SVG 기능까지 그리는지는 어디에도 문서화돼 있지 않다.** 게이지가 의존하는
 * 세 가지(arc path · `<text>` · 한글 글리프)가 실제로 나오는지 확인해야 하고, 이건 실기기에서만
 * 알 수 있다 — 헤드리스 Chrome 으로는 Chrome 의 렌더러를 검증할 뿐이다.
 *
 * 켜는 법 — 둘 중 하나:
 *   touch com.sonky.c-ai-usage.sdPlugin/.svg-probe   (Stream Deck 이 띄우는 프로세스용)
 *   C_AI_USAGE_SVG_PROBE=1                            (직접 띄울 때용)
 *
 * 마커 파일 방식이 필요한 이유: 플러그인 프로세스는 Stream Deck 앱이 띄우므로 셸의 환경변수가
 * 전달되지 않는다. 액션을 다이얼에 올리면 3초 간격으로 4단계가 순환하며 각 단계에서 무엇을
 * 보냈는지 로그에 남는다 — 어느 단계가 그려지고 어느 것이 비는지가 곧 판정이다.
 */

export type ProbeStage = { name: string; describe: string; payload: string };

const ARC = 'M 100 20 A 30 30 0 1 1 78.2 71.3';

/** 게이지가 실제로 쓰는 기능만 담는다 — 그리기에 성공하면 게이지도 그려진다. */
function testSvg(label: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
    '<rect width="200" height="100" fill="#16181c"/>',
    // 1. arc path — 도넛 호. stroke-linecap 까지 확인한다.
    `<circle cx="100" cy="50" r="30" fill="none" stroke="#32363e" stroke-width="8"/>`,
    `<path d="${ARC}" fill="none" stroke="#d97757" stroke-width="8" stroke-linecap="round"/>`,
    // 2. 중앙 정렬 <text> — dominant-baseline 없이 좌표로 잡은 것.
    `<text x="100" y="56" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="16" font-weight="700" fill="#f4f4f5" text-anchor="middle">75%</text>`,
    // 3. 한글 글리프 — 실패 상태 문구가 한글이다.
    `<text x="100" y="88" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="11" fill="#868d98" text-anchor="middle">한글 ${label}</text>`,
    '</svg>',
  ].join('');
}

export function probeStages(): ProbeStage[] {
  const raw = testSvg('raw');
  return [
    { name: 'raw-svg', describe: 'raw <svg> 문자열', payload: raw },
    {
      name: 'base64',
      describe: 'data:image/svg+xml;base64',
      payload: `data:image/svg+xml;base64,${Buffer.from(testSvg('b64'), 'utf8').toString('base64')}`,
    },
    {
      name: 'charset-utf8',
      describe: 'data:image/svg+xml;charset=utf8 (문서화 안 됨)',
      payload: `data:image/svg+xml;charset=utf8,${encodeURIComponent(testSvg('utf8'))}`,
    },
    {
      // 대조군. 이것마저 안 그려지면 SVG 문제가 아니라 레이아웃 키 배선 문제다.
      name: 'png-control',
      describe: '플러그인 내 PNG 경로 (대조군)',
      payload: 'imgs/actions/claude/encoder-icon',
    },
  ];
}

export function probeEnabled(): boolean {
  const v = process.env['C_AI_USAGE_SVG_PROBE'];
  if (v !== undefined && v !== '' && v !== '0') {
    return true;
  }
  // 번들은 `<plugin>.sdPlugin/bin/plugin.js` 로 나오므로 한 단계 위가 플러그인 루트다.
  return existsSync(new URL('../.svg-probe', import.meta.url));
}
