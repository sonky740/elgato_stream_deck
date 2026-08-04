#!/usr/bin/env node
/**
 * 아이콘 PNG 생성 — `imgs/` 아래 16장(1x/2x × 8 자산).
 *
 * 마크는 **270° 트윈 아크**다: 두 겹이 두 창(5H·주간), 두 색이 두 프로바이더를 뜻한다.
 * 아래쪽 90° 를 비워 게이지의 하단 판독부와 같은 실루엣을 갖는다.
 *
 * 왜 스크립트인가: 크기별로 스트로크·간격 비율이 달라(작을수록 굵기를 줄이고 아크를 벌린다)
 * 손으로 만들면 한 장만 어긋나도 눈에 띄지 않는다. media_controller 아이콘 때 재생성
 * 스크립트를 남기지 않아 규격을 다시 복원해야 했다.
 *
 * 사용: node scripts/build-icons.mjs   (헤드리스 Chrome 필요)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'com.sonky.c-ai-usage.sdPlugin', 'imgs');
const TMP = path.join(ROOT, '.icon-build');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const BG = '#16181c';
const MUTED = '#868d98';
const ACCENT = { claude: '#d97757', codex: '#10a37f' };
/**
 * 조역 아크의 흐린 accent. 여기서는 **8자리 hex(알파)를 써도 된다** — 이 SVG 는 Chrome 이
 * 오프라인에서 PNG 로 굽고, 기기에 올라가는 건 PNG 다. 실기기 래스터라이저가 8자리 hex 를
 * 못 읽는 제약은 `src/render/gauge.ts` 쪽(런타임 SVG)에만 적용된다 — 여기를 6자리로
 * "고치면" 투명 배경 자산에서 배경과 섞을 수 없어 오히려 어긋난다.
 */
const dim = (provider) => `${ACCENT[provider]}8c`;

/**
 * 크기대별 기하 비율. **논리 크기**로 분기한다 — 1x/2x 는 같은 논리 크기를 다른 해상도로
 * 그리는 것이므로 같은 분기를 타야 디자인이 일치한다(40px 자산에 40px 분기를 쓰면
 * icon@2x 가 icon 과 다른 그림이 된다).
 *
 * 작아질수록 스트로크를 줄이고 두 아크를 벌린다 — 그대로 축소하면 간격이 1~2px 로 떨어져
 * 두 겹이 한 덩어리로 보이고, 두 겹이 두 창을 뜻한다는 의미가 사라진다.
 */
function geom(logical) {
  if (logical <= 24) {
    return { cy: 0.53, r1: 0.36, r2: 0.15, w: 0.11 };
  }
  if (logical <= 72) {
    return { cy: 0.52, r1: 0.35, r2: 0.16, w: 0.115 };
  }
  return { cy: 150 / 288, r1: 94 / 288, r2: 56 / 288, w: 24 / 288 };
}

const r1 = (n) => Math.round(n * 100) / 100;

/** 12시에서 시계방향. 270° 는 한 A 명령으로 그려진다(largeArc=1). */
function arc(cx, cy, r, fromDeg, toDeg, stroke, width) {
  const at = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${r1(cx + r * Math.sin(rad))} ${r1(cy - r * Math.cos(rad))}`;
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `<path d="M ${at(fromDeg)} A ${r1(r)} ${r1(r)} 0 ${large} 1 ${at(toDeg)}" fill="none" stroke="${stroke}" stroke-width="${r1(width)}" stroke-linecap="round"/>`;
}

function mark({ logical, scale, outer, inner, plate }) {
  const px = logical * scale;
  const g = geom(logical);
  return svgDoc(px, [
    plate
      ? `<rect x="0" y="0" width="${px}" height="${px}" rx="${r1(px * 0.1875)}" fill="${BG}"/>`
      : '',
    arc(px / 2, px * g.cy, px * g.r1, -135, 135, outer, px * g.w),
    arc(px / 2, px * g.cy, px * g.r2, -135, 135, inner, px * g.w),
  ]);
}

/**
 * 키 기본 이미지. 144 캔버스로 설계됐고 1x(72)는 그 절반으로 굽는다.
 * 프로바이더 이름은 144 에서 읽히는 크기다 — 72 자산에서는 장식으로 남는다(실기기는 @2x 를 쓴다).
 */
function keyIcon({ provider, scale }) {
  const s = (n) => r1(n * scale);
  const px = 144 * scale;
  return svgDoc(px, [
    `<rect x="0" y="0" width="${px}" height="${px}" rx="${s(16)}" fill="${BG}"/>`,
    arc(s(72), s(76), s(47), -135, 135, ACCENT[provider], s(12)),
    arc(s(72), s(76), s(28), -135, 135, dim(provider), s(12)),
    `<text x="${s(72)}" y="${s(130)}" font-family="-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif" font-size="${s(11)}" fill="${MUTED}" font-weight="600" text-anchor="middle" letter-spacing="${s(1.2)}">${provider === 'claude' ? 'CLAUDE' : 'CODEX'}</text>`,
  ]);
}

function svgDoc(px, parts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${parts.filter(Boolean).join('')}</svg>`;
}

/** 자산 목록. `logical` 은 Stream Deck 이 표시하는 논리 크기이고 파일은 1x/2x 두 장이다. */
const ASSETS = [
  // 마켓플레이스: 두 색 = 두 프로바이더, 유일하게 배경판이 있다(스토어에서 단독으로 선다).
  {
    file: 'plugin/marketplace',
    logical: 256,
    svg: (s) =>
      mark({ logical: 256, scale: s, outer: ACCENT.claude, inner: ACCENT.codex, plate: true }),
  },
  // 카테고리: Stream Deck UI 의 좁은 목록에 서므로 브랜드색 없이 모노다.
  {
    file: 'plugin/category-icon',
    logical: 28,
    svg: (s) => mark({ logical: 28, scale: s, outer: '#f4f4f5', inner: '#a1a1aa' }),
  },
  ...['claude', 'codex'].flatMap((p) => [
    // 액션 목록 아이콘. 두 액션이 나란히 서므로 모노가 아니라 프로바이더색이어야 구분된다.
    {
      file: `actions/${p}/icon`,
      logical: 20,
      svg: (s) => mark({ logical: 20, scale: s, outer: ACCENT[p], inner: dim(p) }),
    },
    {
      file: `actions/${p}/encoder-icon`,
      logical: 72,
      svg: (s) => mark({ logical: 72, scale: s, outer: ACCENT[p], inner: dim(p) }),
    },
    { file: `actions/${p}/key`, logical: 72, svg: (s) => keyIcon({ provider: p, scale: s / 2 }) },
  ]),
];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

for (const asset of ASSETS) {
  for (const scale of [1, 2]) {
    const svg = asset.svg(scale);
    const px = asset.logical * scale;
    const name = `${asset.file.replace(/\//g, '_')}@${scale}x`;
    const html = path.join(TMP, `${name}.html`);
    writeFileSync(
      html,
      `<!doctype html><meta charset=utf-8><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg}`,
    );
    const dest = path.join(OUT, `${asset.file}${scale === 2 ? '@2x' : ''}.png`);
    mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--default-background-color=00000000',
        '--force-device-scale-factor=1',
        `--window-size=${px},${px}`,
        `--screenshot=${dest}`,
        `file://${html}`,
      ],
      { stdio: 'ignore' },
    );
    console.log(`${dest.slice(OUT.length + 1)}  ${px}x${px}`);
  }
}

rmSync(TMP, { recursive: true, force: true });
