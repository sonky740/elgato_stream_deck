#!/usr/bin/env node
/**
 * 아이콘 PNG 생성 — `imgs/` 아래 16장(1x/2x × 8 자산).
 *
 * 마크와 색은 [lib/mark-svg.mjs](lib/mark-svg.mjs) 가 소유한다 — 스토어 앱 아이콘도 같은
 * 기하를 쓰기 때문이다.
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

import { ACCENT, arc, BG, dim, mark, MONO, MONO_DIM, MUTED, svgDoc } from './lib/mark-svg.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'com.sonky.c-ai-usage.sdPlugin', 'imgs');
const TMP = path.join(ROOT, '.icon-build');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const r1 = (n) => Math.round(n * 100) / 100;

/**
 * 키 기본 이미지. 144 캔버스로 설계됐고 1x(72)는 그 절반으로 굽는다.
 * 프로바이더 이름은 144 에서 읽히는 크기다 — 72 자산에서는 장식으로 남는다(실기기는 @2x 를 쓴다).
 */
const keyIcon = ({ provider, scale }) => {
  const s = (n) => r1(n * scale);
  const px = 144 * scale;
  return svgDoc(px, [
    `<rect x="0" y="0" width="${px}" height="${px}" rx="${s(16)}" fill="${BG}"/>`,
    arc(s(72), s(76), s(47), -135, 135, ACCENT[provider], s(12)),
    arc(s(72), s(76), s(28), -135, 135, dim(provider), s(12)),
    `<text x="${s(72)}" y="${s(130)}" font-family="-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif" font-size="${s(11)}" fill="${MUTED}" font-weight="600" text-anchor="middle" letter-spacing="${s(1.2)}">${provider === 'claude' ? 'CLAUDE' : 'CODEX'}</text>`,
  ]);
};

/** 자산 목록. `logical` 은 Stream Deck 이 표시하는 논리 크기이고 파일은 1x/2x 두 장이다. */
const ASSETS = [
  // 마켓플레이스: 두 색 = 두 프로바이더, 유일하게 배경판이 있다(스토어에서 단독으로 선다).
  {
    file: 'plugin/marketplace',
    logical: 256,
    svg: (s) =>
      mark({ logical: 256, scale: s, outer: ACCENT.claude, inner: ACCENT.codex, plate: true }),
  },
  // 카테고리: Stream Deck UI 의 좁은 목록에 선다 — 가이드라인상 #FFFFFF 단색.
  {
    file: 'plugin/category-icon',
    logical: 28,
    svg: (s) => mark({ logical: 28, scale: s, outer: MONO, inner: MONO_DIM }),
  },
  ...['claude', 'codex'].flatMap((p) => [
    // 액션 목록 아이콘. 단색 강제이므로 두 프로바이더가 **같은 그림**이 된다 — 구분은 액션 이름이 한다.
    {
      file: `actions/${p}/icon`,
      logical: 20,
      svg: (s) => mark({ logical: 20, scale: s, outer: MONO, inner: MONO_DIM }),
    },
    // 다이얼의 원형 캔버스에 서는 자리다(액션 목록이 아니다) — 단색 강제 대상이 아니라 브랜드색을 남긴다.
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
