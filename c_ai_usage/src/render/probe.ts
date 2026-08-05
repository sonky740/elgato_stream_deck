import { existsSync } from 'node:fs';

/**
 * 게이트 1 — Stream Deck SVG 래스터라이저 실기기 확인용 프로브.
 *
 * Elgato 스키마는 pixmap `value` 와 `setImage` 가 raw SVG 문자열·base64 data URI 를 받는다고
 * 명시하지만, **어떤 SVG 기능까지 그리는지는 어디에도 문서화돼 있지 않다.** 게이지가 의존하는
 * 것(arc path · `<text>` · 한글 글리프)이 실제로 나오는지는 실기기에서만 알 수 있다 —
 * 헤드리스 Chrome 으로는 Chrome 의 렌더러를 검증할 뿐이다.
 *
 * 각 단계는 **ASCII 로 자기 번호를 표시한다.** 한글이 안 그려지는 경우에도 어느 단계가 화면에
 * 나왔는지 식별할 수 있어야 하기 때문이다 — 1차 관찰에서 이게 없어 단계 구분이 안 됐다.
 * 한글 검증은 `KO:` 라벨 뒤에 붙여, 라벨만 보이고 뒤가 비면 글리프가 없다는 뜻이 된다.
 *
 * 켜는 법 — 둘 중 하나:
 *   touch com.sonky.c-ai-usage.sdPlugin/.svg-probe   (Stream Deck 이 띄우는 프로세스용)
 *   C_AI_USAGE_SVG_PROBE=1                            (직접 띄울 때용)
 */

export type ProbeStage = { name: string; describe: string; payload: string };

/** 12시에서 시계방향 75% 지점까지의 호. 게이지가 쓰는 것과 같은 형태다. */
const ARC = 'M 100 20 A 30 30 0 1 1 78.2 71.3';

function testSvg(stageNo: number): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
    '<rect width="200" height="100" fill="#16181c"/>',
    // 단계 번호 — ASCII. 이것만 보이면 그 단계는 최소한 그려진 것이다.
    `<text x="10" y="26" font-family="Helvetica,Arial,sans-serif" font-size="22" font-weight="700" fill="#d97757">${stageNo}</text>`,
    // arc path + stroke-linecap — 도넛 호가 의존하는 기능.
    '<circle cx="100" cy="50" r="30" fill="none" stroke="#32363e" stroke-width="8"/>',
    `<path d="${ARC}" fill="none" stroke="#d97757" stroke-width="8" stroke-linecap="round"/>`,
    // 중앙 정렬 <text> — dominant-baseline 없이 좌표로 잡은 것.
    '<text x="100" y="56" font-family="Helvetica,Arial,sans-serif" font-size="16" font-weight="700" fill="#f4f4f5" text-anchor="middle">75%</text>',
    // 한글 글리프. `KO:` 는 ASCII 라 항상 보인다 — 뒤가 비면 글리프가 없는 것이다.
    '<text x="100" y="90" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#f4f4f5" text-anchor="middle">KO:한글</text>',
    '</svg>',
  ].join('');
}

export function probeStages(): ProbeStage[] {
  return [
    { name: '1 raw-svg', describe: 'raw <svg> string', payload: testSvg(1) },
    {
      name: '2 base64',
      describe: 'data:image/svg+xml;base64',
      payload: `data:image/svg+xml;base64,${Buffer.from(testSvg(2), 'utf8').toString('base64')}`,
    },
    {
      name: '3 charset-utf8',
      describe: 'data:image/svg+xml;charset=utf8 (undocumented)',
      payload: `data:image/svg+xml;charset=utf8,${encodeURIComponent(testSvg(3))}`,
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

/** 단계 전환 간격. 1차 관찰에서 3초가 짧아 읽기 어려웠다. */
export const PROBE_INTERVAL_MS = 5000;
