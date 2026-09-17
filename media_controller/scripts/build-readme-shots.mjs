#!/usr/bin/env node
/**
 * README 용 스크린샷 생성 — `docs/dial.png` (터치스트립 200×100). 실기기 캡처가 아니라 레이아웃
 * 재구성이고, 이유와 한계는 [lib/dial-svg.mjs](lib/dial-svg.mjs) 에 있다. ⚠ **배경을 굽는다** —
 * 투명 PNG 로 내보내면 GitHub 라이트 모드에서 흰 글자가 사라진다.
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
