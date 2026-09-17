#!/usr/bin/env node
/**
 * Claude Code statusline 훅. stdin 으로 들어온 세션 페이로드에서 `rate_limits` 를 뽑아
 * 고정 경로 JSON 으로 덮어쓰고, 사람이 읽을 상태줄을 stdout 으로 낸다.
 *
 * 플러그인의 tier 1 이 이 파일을 읽는다 — 그 경로에서 네트워크 요청이 0이 된다.
 * 파일은 tmp 에 쓴 뒤 rename 한다. 플러그인이 반쯤 쓰인 JSON 을 읽으면 파싱이 실패하고,
 * 실패는 곧 폴링 요청이므로 원자성이 폴링 빈도에 직접 영향을 준다.
 *
 * 설치:
 *   ~/.claude/settings.json 에
 *   "statusLine": { "type": "command", "command": "node <이 파일의 절대경로>" }
 *
 * `rate_limits` 는 claude.ai 구독자에게, 그리고 세션의 첫 API 응답 이후에만 채워진다.
 * 없으면 캐시를 건드리지 않는다 — 빈 값으로 덮어쓰면 tier 1 이 "신선한데 데이터 없음"이 된다.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE =
  process.env.C_AI_USAGE_STATUSLINE_CACHE ??
  path.join(os.homedir(), '.claude', 'c-ai-usage-statusline.json');

const pct = (v) => {
  return typeof v === 'number' ? `${Math.floor(v)}%` : null;
};

const statusLine = (p, rl) => {
  const parts = [];
  const model = p?.model?.display_name;
  if (typeof model === 'string' && model !== '') {
    parts.push(model);
  }
  const five = pct(rl?.five_hour?.used_percentage);
  const week = pct(rl?.seven_day?.used_percentage);
  if (five !== null) {
    parts.push(`5H ${five}`);
  }
  if (week !== null) {
    parts.push(`WK ${week}`);
  }
  return parts.join('  ·  ');
};

const read = (stream) => {
  return new Promise((resolve) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      data += chunk;
    });
    stream.on('end', () => resolve(data));
    stream.on('error', () => resolve(data));
  });
};

const stdin = await read(process.stdin);
let payload = {};
try {
  payload = JSON.parse(stdin);
} catch {
  // 페이로드를 못 읽어도 상태줄은 내보낸다 — 여기서 죽으면 사용자 상태줄이 사라진다.
}

const limits = payload?.rate_limits;
if (limits !== undefined && limits !== null) {
  try {
    mkdirSync(path.dirname(CACHE), { recursive: true });
    const tmp = `${CACHE}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ writtenAtMs: Date.now(), rate_limits: limits }));
    renameSync(tmp, CACHE);
  } catch {
    // 캐시 실패는 조용히 넘긴다. 플러그인이 tier 2 로 자연히 넘어간다.
  }
}

process.stdout.write(statusLine(payload, limits));
