#!/usr/bin/env node
/**
 * README 용 스크린샷 생성 — `docs/` 아래 4장(키·다이얼 × 도넛·바).
 *
 * 입력은 `npm test` 가 만드는 `preview/*.svg` 다. 렌더러를 다시 구현하지 않는 이유가 그것이다 —
 * 사본을 만들면 README 이미지가 실제 렌더와 따로 낡는다. preview 는 `ko-`/`en-` 두 세트인데
 * README 가 영문이므로 **`en-` 쪽**을 쓴다.
 *
 * ⚠ **배경을 굽는다.** 런타임 SVG 는 캔버스를 칠하지 않으므로(SPEC §22) 그대로 PNG 로 만들면
 * 투명 배경이 되고, GitHub 라이트 모드의 흰 배경에서 판독 숫자(`#f4f4f5`)가 사라진다. 여기서
 * 칠하는 `#16181c` 는 스트림덱 프로필 배경을 대신하는 것이다 — README 에도 그렇게 적었다.
 * (`build-icons.mjs` 의 `--default-background-color=00000000` 을 복사하면 안 된다. 그건
 * 투명 PNG 가 필요한 아이콘용이고, 여기서는 정확히 그게 실패다.)
 *
 * 사용: npm test && node scripts/build-readme-shots.mjs   (헤드리스 Chrome 필요)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const PREVIEW = path.join(ROOT, 'preview');
const OUT = path.join(ROOT, 'docs');
const TMP = path.join(ROOT, '.readme-shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** 프로필 배경 대역. 기기에서 이 자리는 스트림덱이 칠한다. */
const BG = '#16181c';

/** 선명도 배수. 기기 해상도가 아니라 표시 밀도용이다 — 표시 크기는 README 의 `width` 가 잡는다. */
const SCALE = 2;

/**
 * 네 장 모두 **같은 픽스처·같은 기준**(`used` · 5H 37% / 주간 26%)을 쓴다. 레이아웃만 비교되게
 * 하려는 것이다 — 한 장에 Codex 나 경고 상태를 섞으면 레이아웃 차이와 상태 차이가 뒤섞인다.
 */
const SHOTS = [
  { name: 'key-donut', src: 'en-key-donut-used-ok-both.svg', w: 144, h: 144 },
  { name: 'key-bar', src: 'en-key-bar-used-ok-both.svg', w: 144, h: 144 },
  { name: 'dial-donut', src: 'en-dial-donut-used-ok-both.svg', w: 200, h: 100 },
  { name: 'dial-bar', src: 'en-dial-bar-used-ok-both.svg', w: 200, h: 100 },
];

const missing = SHOTS.filter((s) => !existsSync(path.join(PREVIEW, s.src))).map((s) => s.src);
if (missing.length > 0) {
  // 조용히 옛 preview/ 를 굽지 않는다 — 실제 렌더와 어긋난 README 는 보기에 멀쩡하다.
  console.error(`missing preview SVG: ${missing.join(', ')}`);
  console.error('run `npm test` first — the tests wipe and rebuild preview/ every time.');
  process.exit(1);
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

for (const shot of SHOTS) {
  const svg = readFileSync(path.join(PREVIEW, shot.src), 'utf8');
  const html = path.join(TMP, `${shot.name}.html`);
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>` +
      `html,body{margin:0;padding:0;background:${BG}}svg{display:block}</style>${svg}`,
  );
  const dest = path.join(OUT, `${shot.name}.png`);
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${shot.w},${shot.h}`,
    `--screenshot=${dest}`,
    html,
  ]);
  console.log(`${shot.name}.png  ${shot.w * SCALE}×${shot.h * SCALE}`);
}

rmSync(TMP, { recursive: true, force: true });
