#!/usr/bin/env node
/**
 * README 용 스크린샷 생성 — `docs/dial.png` (터치스트립 200×100).
 *
 * ⚠ **실기기 캡처가 아니라 재구성이다.** 이 플러그인은 c_ai_usage 처럼 SVG 를 만들지 않는다 —
 * `setFeedback` 으로 값만 보내고 그리는 건 기기의 레이아웃 렌더러다. 그래서 뽑아낼 렌더 산출물이
 * 없고, 대신 **레이아웃 정의를 읽어** 같은 rect·폰트 크기·굵기·색으로 다시 그린다.
 * 재현되지 않는 것: 기기의 폰트 패밀리와 안티에일리어싱. 그 외 기하는 아래 JSON 이 결정한다.
 *
 * 레이아웃을 파싱하는 이유가 그것이다 — 좌표를 여기 베껴 두면 레이아웃을 고칠 때 그림만
 * 조용히 옛것으로 남는다.
 *
 * ⚠ **배경을 굽는다.** 레이아웃에 배경 item 이 없어 기기에서는 프로필 배경이 비친다 — 투명 PNG 로
 * 내보내면 GitHub 라이트 모드에서 흰 글자가 사라진다. c_ai_usage 와 같은 `#16181c` 를 쓴다.
 *
 * 곡 정보는 **자리표시 문자열**이다. 실제 곡·아티스트를 넣으면 특정 음원에 대한 캡처처럼 보인다.
 *
 * 사용: node scripts/build-readme-shots.mjs   (헤드리스 Chrome 필요)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const PLUGIN = path.join(ROOT, 'com.sonky.media-controller.sdPlugin');
const OUT = path.join(ROOT, 'docs');
const TMP = path.join(ROOT, '.readme-shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const BG = '#16181c';
const SCALE = 2;
const FONT = "-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** 자리표시 곡 정보. 실제 음원을 쓰지 않는다. README 가 영문이라 문구도 영문이다. */
const SAMPLE = { title: 'Song title', artist: 'Artist', album: 'Album' };

const layout = JSON.parse(readFileSync(path.join(PLUGIN, 'layouts', 'now-playing.json'), 'utf8'));
const item = (key) => {
  const found = layout.items.find((i) => i.key === key);
  if (found === undefined) {
    throw new Error(
      `layout has no '${key}' item — check whether the render call site changed with it.`,
    );
  }
  return found;
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 레이아웃 text item 을 그린다. rect 안 세로 중앙에 놓는다. */
function text(key, value) {
  const { rect, font, color } = item(key);
  const [x, y, , h] = rect;
  const size = font.size;
  const baseline = y + h / 2 + size * 0.35;
  return (
    `<text x="${x}" y="${baseline.toFixed(1)}" font-family="${FONT}" font-size="${size}"` +
    ` font-weight="${font.weight}" fill="${color}">${esc(value)}</text>`
  );
}

/**
 * 앨범아트 자리. 기기에서는 플레이어가 준 커버가 들어간다 — 실제 앨범 커버를 쓰지 않으려고
 * 추상 도형으로 대신한다. rect 는 레이아웃이 정한다.
 */
function albumArt() {
  const [x, y, w, h] = item('albumArt').rect;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#2a2f3a"/>` +
    `<circle cx="${x + w * 0.5}" cy="${y + h * 0.5}" r="${w * 0.3}" fill="none" stroke="#4d566a" stroke-width="${w * 0.09}"/>` +
    `<circle cx="${x + w * 0.5}" cy="${y + h * 0.5}" r="${w * 0.07}" fill="#4d566a"/>`
  );
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">` +
  albumArt() +
  text('title', SAMPLE.title) +
  text('artist', SAMPLE.artist) +
  text('album', SAMPLE.album) +
  `</svg>`;

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

const html = path.join(TMP, 'dial.html');
writeFileSync(
  html,
  `<!doctype html><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0;background:${BG}}svg{display:block}</style>${svg}`,
);
const dest = path.join(OUT, 'dial.png');
execFileSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  `--force-device-scale-factor=${SCALE}`,
  '--window-size=200,100',
  `--screenshot=${dest}`,
  html,
]);
rmSync(TMP, { recursive: true, force: true });
console.log(`dial.png  ${200 * SCALE}×${100 * SCALE}  (rebuilt from the layout definition)`);
