#!/usr/bin/env node
/**
 * Elgato Marketplace 제출용 자산 생성 — `store/` 아래 갤러리 4장 + 앱 아이콘 1장.
 *
 * 렌더러도 마크 기하도 다시 구현하지 않는다(사본은 실제 렌더와 따로 낡는다) — 갤러리 입력은
 * `preview/*.svg`, 마크는 [lib/mark-svg.mjs](lib/mark-svg.mjs) 다. ⚠ 게이지 SVG 는 캔버스를
 * 칠하지 않으므로(SPEC "캔버스를 칠하지 않는다") 프레임 배경과 기기 판을 여기서 칠한다.
 * 규격·산출물 취급은 저장소 루트 CLAUDE.md 참고.
 *
 * 사용: npm test && node scripts/build-store-shots.mjs   (헤드리스 Chrome 필요)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ACCENT, arc, BG, svgDoc, TEXT } from './lib/mark-svg.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const PREVIEW = path.join(ROOT, 'preview');
const OUT = path.join(ROOT, 'store');
const TMP = path.join(ROOT, '.store-shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const GALLERY = { w: 1920, h: 960 };
const APP_ICON = 288;

const FONT = "-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";
const PAGE_BG = '#0f1114';
const MUTED = '#868d98';

/**
 * 갤러리 프레임. `split` 은 문구 왼쪽 + 기기 오른쪽, `row` 는 문구 위 + 기기 가로 나열이다.
 * 넷을 같은 구도로 두면 스토어에서 한 장만 본 것처럼 보인다.
 */
const SHOTS = [
  {
    name: '01-dial-donut',
    kind: 'split',
    headline: 'Your AI usage, on the dial',
    sub: 'The 5-hour and weekly windows of a Claude or Codex subscription, as live gauges.',
    items: [{ src: 'en-dial-donut-used-ok-both.svg', w: 200, h: 100, scale: 3.4 }],
  },
  {
    name: '02-dial-bar',
    kind: 'split',
    headline: 'Two chart styles',
    sub: 'Turn the dial to switch donut ↔ bar. Push or tap to flip used ↔ remaining.',
    items: [{ src: 'en-dial-bar-used-ok-both.svg', w: 200, h: 100, scale: 3.4 }],
  },
  {
    name: '03-keys',
    kind: 'split',
    headline: 'Keys, not just dials',
    sub: 'The same gauges render at key resolution. Press a key to cycle the chart.',
    items: [
      { src: 'en-key-donut-used-ok-both.svg', w: 144, h: 144, scale: 2.1 },
      { src: 'en-key-bar-used-ok-both.svg', w: 144, h: 144, scale: 2.1 },
    ],
  },
  {
    name: '04-thresholds',
    kind: 'row',
    headline: 'Color-coded thresholds',
    sub: 'Amber and red arrive at the limits you set per action — 80% and 95% by default.',
    items: [
      { src: 'en-dial-donut-used-ok-both.svg', w: 200, h: 100, scale: 2.6, caption: 'Safe' },
      { src: 'en-dial-donut-used-warn.svg', w: 200, h: 100, scale: 2.6, caption: 'Warning' },
      { src: 'en-dial-donut-used-crit.svg', w: 200, h: 100, scale: 2.6, caption: 'Critical' },
    ],
  },
];

const sources = SHOTS.flatMap((shot) => shot.items.map((item) => item.src));
const missing = sources.filter((src) => !existsSync(path.join(PREVIEW, src)));
if (missing.length > 0) {
  // 조용히 옛 preview/ 를 굽지 않는다 — 실제 렌더와 어긋난 스토어 자산은 보기에 멀쩡하다.
  console.error(`missing preview SVG: ${[...new Set(missing)].join(', ')}`);
  console.error('run `npm test` first — the tests wipe and rebuild preview/ every time.');
  process.exit(1);
}

/** 기기 판. 런타임 SVG 가 칠하지 않는 배경을 대신하고, 그림자로 화면을 배경에서 띄운다. */
const device = (item) => {
  const svg = readFileSync(path.join(PREVIEW, item.src), 'utf8')
    .replace(/width="\d+"/, `width="${item.w * item.scale}"`)
    .replace(/height="\d+"/, `height="${item.h * item.scale}"`);
  const caption =
    item.caption === undefined ? '' : `<figcaption class="caption">${item.caption}</figcaption>`;
  return `<figure class="device"><div class="screen">${svg}</div>${caption}</figure>`;
};

const frame = (shot) => {
  const stage = `<div class="stage">${shot.items.map(device).join('')}</div>`;
  const copy = `<hgroup class="copy"><h1>${shot.headline}</h1><p>${shot.sub}</p></hgroup>`;
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${GALLERY.w}px;height:${GALLERY.h}px;overflow:hidden}
    body{background:${PAGE_BG};color:${TEXT};font-family:${FONT};
      background-image:radial-gradient(120% 90% at 78% 20%, #1d2230 0%, transparent 60%)}
    .page{box-sizing:border-box;height:100%;display:flex;padding:0 128px;gap:96px}
    .page.split{flex-direction:row;align-items:center}
    /* 세로 배치에서는 stage 가 남은 높이를 다 먹으면 문구가 위로 밀려 프레임 밖으로 잘린다. */
    .page.row{flex-direction:column;align-items:center;justify-content:center;gap:88px;
      padding:96px 128px;text-align:center}
    .row .stage{flex:none}
    .copy{margin:0}
    .split .copy{width:660px;flex:none}
    .row .copy{max-width:1200px}
    h1{margin:0 0 28px;font-size:76px;line-height:1.04;letter-spacing:-2px;font-weight:700}
    .row h1{font-size:68px}
    p{margin:0;font-size:32px;line-height:1.42;color:${MUTED}}
    .stage{display:flex;flex:1;align-items:center;justify-content:center;gap:64px}
    .device{margin:0;display:flex;flex-direction:column;align-items:center;gap:24px}
    .screen{background:${BG};border-radius:22px;padding:26px;
      box-shadow:0 34px 90px rgba(0,0,0,.55);display:flex}
    .caption{font-size:28px;color:${MUTED};letter-spacing:.5px}
  </style><div class="page ${shot.kind}">${copy}${stage}</div>`;
};

/**
 * 스토어 앱 아이콘. 내부 아이콘(256/512)과 달리 **워드마크를 넣는다** — 추상 트윈 아크라 제품
 * 카드에서 마크 혼자로는 읽히지 않는다. 마크를 줄여 올리고 아래에 이름 띠를 두므로 내부 아이콘을
 * 그대로 줄여 쓸 수 없다. 기하는 [lib/mark-svg.mjs](lib/mark-svg.mjs) 가 소유한다.
 */
const appIconHtml = () => {
  const px = APP_ICON;
  const svg = svgDoc(px, [
    `<rect x="0" y="0" width="${px}" height="${px}" rx="${px * 0.1875}" fill="${BG}"/>`,
    arc(px / 2, 118, 76, -135, 135, ACCENT.claude, 19),
    arc(px / 2, 118, 45, -135, 135, ACCENT.codex, 19),
    `<text x="${px / 2}" y="238" font-family="${FONT}" font-size="26" font-weight="700"` +
      ` fill="${TEXT}" text-anchor="middle" letter-spacing="2.2">C AI USAGE</text>`,
  ]);
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}svg{display:block}
  </style>${svg}`;
};

const shoot = ({ name, html, w, h, transparent }) => {
  const file = path.join(TMP, `${name}.html`);
  writeFileSync(file, html);
  const dest = path.join(OUT, `${name}.png`);
  execFileSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      ...(transparent === true ? ['--default-background-color=00000000'] : []),
      '--force-device-scale-factor=1',
      `--window-size=${w},${h}`,
      `--screenshot=${dest}`,
      `file://${file}`,
    ],
    { stdio: 'ignore' },
  );
  console.log(`${name}.png  ${w}×${h}`);
};

rmSync(TMP, { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

for (const shot of SHOTS) {
  shoot({ name: shot.name, html: frame(shot), w: GALLERY.w, h: GALLERY.h });
}
shoot({
  name: 'app-icon',
  html: appIconHtml(),
  w: APP_ICON,
  h: APP_ICON,
  transparent: true,
});

rmSync(TMP, { recursive: true, force: true });
