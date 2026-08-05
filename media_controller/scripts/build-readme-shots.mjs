#!/usr/bin/env node
/**
 * README 용 스크린샷 생성 — `docs/dial.png` (터치스트립 200×100).
 *
 * 그림은 실기기 캡처가 아니라 레이아웃 정의로부터의 재구성이다 — 이유와 한계는
 * [lib/dial-svg.mjs](lib/dial-svg.mjs) 에 있다.
 *
 * ⚠ **배경을 굽는다.** 레이아웃에 배경 item 이 없어 기기에서는 프로필 배경이 비친다 — 투명 PNG 로
 * 내보내면 GitHub 라이트 모드에서 흰 글자가 사라진다. c_ai_usage 와 같은 `#16181c` 를 쓴다.
 *
 * 사용: node scripts/build-readme-shots.mjs   (헤드리스 Chrome 필요)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dialSvg, PLACEHOLDER_TRACK } from './lib/dial-svg.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs');
const TMP = path.join(ROOT, '.readme-shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const BG = '#16181c';
const SCALE = 2;

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

const html = path.join(TMP, 'dial.html');
writeFileSync(
  html,
  `<!doctype html><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0;background:${BG}}svg{display:block}</style>` +
    dialSvg(PLACEHOLDER_TRACK),
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
