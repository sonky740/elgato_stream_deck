#!/usr/bin/env node
/**
 * Elgato Marketplace 제출용 자산 생성 — `store/` 아래 갤러리 3장 + 앱 아이콘 1장.
 *
 * 입력은 커밋된 자산뿐이고 기하를 여기 베끼지 않는다 — 터치스트립은
 * [lib/dial-svg.mjs](lib/dial-svg.mjs) 의 레이아웃 재구성, 키와 앱 아이콘은 `imgs/` 의 PNG 다.
 * 규격·산출물 취급은 저장소 루트 CLAUDE.md 참고.
 *
 * 사용: node scripts/build-store-shots.mjs   (헤드리스 Chrome 필요)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dialSvg, PLACEHOLDER_TRACK } from './lib/dial-svg.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const PLUGIN = path.join(ROOT, 'com.sonky.media-controller.sdPlugin');
const OUT = path.join(ROOT, 'store');
const TMP = path.join(ROOT, '.store-shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const GALLERY = { w: 1920, h: 960 };
const APP_ICON = 288;

const FONT = "-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";
const PAGE_BG = '#0f1114';
const PLATE = '#16181c';
const TEXT = '#f4f4f5';
const MUTED = '#868d98';

const dial = (scale, caption) => ({ kind: 'dial', w: 200, h: 100, scale, caption });
const key = (action, scale, caption) => ({
  kind: 'key',
  src: path.join(PLUGIN, 'imgs', 'actions', action, 'key@2x.png'),
  w: 144,
  h: 144,
  scale,
  caption,
});

/**
 * 갤러리 프레임. `split` 은 문구 왼쪽 + 기기 오른쪽, `row` 는 문구 위 + 기기 가로 나열이다.
 * 셋을 같은 구도로 두면 스토어에서 한 장만 본 것처럼 보인다.
 */
const SHOTS = [
  {
    name: '01-dial',
    kind: 'split',
    headline: 'Now playing, on the dial',
    sub: 'Album art, title, artist and album — straight from the OS media session.',
    items: [dial(3.4)],
  },
  {
    name: '02-keys',
    kind: 'row',
    headline: 'Or three plain keys',
    sub: 'No dial required. Now Playing swaps its icon for the album art while a track plays, with transport keys beside it.',
    items: [
      key('previous', 1.9, 'Previous'),
      key('now-playing', 1.9, 'Now Playing'),
      key('next', 1.9, 'Next'),
    ],
  },
  {
    name: '03-controls',
    kind: 'row',
    headline: 'Every control mapped',
    sub: 'Works with any player, because the track comes from the OS media session — browser tabs included.',
    items: [
      dial(2.6, 'Rotate: previous / next · Push or touch: play / pause'),
      key('now-playing', 2.2, 'Press: play / pause'),
    ],
  },
];

/** 기기 판. 다이얼 SVG 는 배경이 없어 판을 깔고, 키 PNG 는 자기 판을 이미 갖고 있어 그대로 둔다. */
const device = (item) => {
  const caption =
    item.caption === undefined ? '' : `<figcaption class="caption">${item.caption}</figcaption>`;
  const screen =
    item.kind === 'dial'
      ? `<div class="screen">${dialSvg(PLACEHOLDER_TRACK)
          .replace(/width="\d+"/, `width="${item.w * item.scale}"`)
          .replace(/height="\d+"/, `height="${item.h * item.scale}"`)}</div>`
      : `<img class="key" width="${item.w * item.scale}" height="${item.h * item.scale}"` +
        ` src="data:image/png;base64,${readFileSync(item.src).toString('base64')}">`;
  return `<figure class="device">${screen}${caption}</figure>`;
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
    .row .copy{max-width:1240px}
    h1{margin:0 0 28px;font-size:76px;line-height:1.04;letter-spacing:-2px;font-weight:700}
    .row h1{font-size:68px}
    p{margin:0;font-size:32px;line-height:1.42;color:${MUTED}}
    .stage{display:flex;flex:1;align-items:center;justify-content:center;gap:64px}
    .device{margin:0;display:flex;flex-direction:column;align-items:center;gap:24px}
    .screen{background:${PLATE};border-radius:22px;padding:26px;
      box-shadow:0 34px 90px rgba(0,0,0,.55);display:flex}
    .key{display:block;border-radius:26px;box-shadow:0 34px 90px rgba(0,0,0,.55)}
    .caption{font-size:26px;color:${MUTED};letter-spacing:.3px}
  </style><div class="page ${shot.kind}">${copy}${stage}</div>`;
};

/**
 * 앱 아이콘은 커밋된 512 자산을 288 로 줄인 것이다 — **워드마크가 없다.** 이 마크는 벡터 소스가
 * 없는 디자인 PNG 이고 캔버스를 꽉 채워, 이름 띠 자리를 만들려면 마크를 다시 그려야 한다. 재생
 * 글리프는 그 자체로 읽히므로 v1 은 로고만 쓴다(가이드라인은 "제품명 **또는** 로고"를 요구한다).
 */
const appIconHtml = () => {
  const png = readFileSync(path.join(PLUGIN, 'imgs', 'plugin', 'marketplace@2x.png'));
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}img{display:block}
  </style><img width="${APP_ICON}" height="${APP_ICON}" src="data:image/png;base64,${png.toString('base64')}">`;
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
shoot({ name: 'app-icon', html: appIconHtml(), w: APP_ICON, h: APP_ICON, transparent: true });

rmSync(TMP, { recursive: true, force: true });
