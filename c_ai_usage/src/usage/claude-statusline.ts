import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { assignSlots, type UsageSlots, type UsageWindow } from './types';

/**
 * statusline 훅이 남긴 캐시 경로. Claude Code 가 서버에서 받아온 값을 우리 스크립트가 덮어써 둔
 * 것이라 로컬 파일이지만 수치는 계정 범위·서버 계산이다(ai-limits-plan.md §4.3).
 *
 * 호출 시점에 해석한다 — 모듈 로드 시점에 고정하면 환경변수 변경이 플러그인 재시작을 요구한다.
 */
function cacheFile(): string {
  return (
    process.env['C_AI_USAGE_STATUSLINE_CACHE'] ??
    path.join(os.homedir(), '.claude', 'c-ai-usage-statusline.json')
  );
}

/**
 * 이 나이를 넘으면 없는 것으로 취급해 tier 2 로 넘긴다. `rate_limits` 는 세션의 첫 API 응답
 * 이후에만 채워지므로, Claude Code 를 안 쓰는 동안 이 캐시는 계속 낡는다.
 */
const FRESH_MS = 90_000;

const FIVE_HOUR_SEC = 5 * 60 * 60;
const WEEK_SEC = 7 * 24 * 60 * 60;

/** 신선한 캐시가 없으면 `null`. 그 경우 호출자가 직접 폴링한다. */
export async function readStatuslineSlots(nowMs: number): Promise<UsageSlots | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(cacheFile(), 'utf8'));
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  const writtenAtMs = root?.['writtenAtMs'];
  if (typeof writtenAtMs !== 'number' || nowMs - writtenAtMs > FRESH_MS) {
    return null;
  }
  const limits = asRecord(root?.['rate_limits']);
  if (limits === null) {
    return null;
  }
  const windows: UsageWindow[] = [];
  push(windows, limits['five_hour'], '5H', FIVE_HOUR_SEC);
  push(windows, limits['seven_day'], 'WK', WEEK_SEC);
  return windows.length === 0 ? null : assignSlots(windows);
}

/**
 * statusline 페이로드의 창 하나를 정규화한다. 필드명·시간 포맷이 HTTP 응답과 **둘 다 다르다**:
 * `used_percentage`(HTTP 는 `utilization`), epoch 초(HTTP 는 ISO 문자열).
 */
function push(out: UsageWindow[], raw: unknown, label: string, durationSec: number): void {
  const rec = asRecord(raw);
  if (rec === null) {
    return;
  }
  const used = rec['used_percentage'];
  const resetsAt = rec['resets_at'];
  out.push({
    label,
    durationSec,
    utilization: typeof used === 'number' ? used : null,
    resetsAtMs: typeof resetsAt === 'number' ? resetsAt * 1000 : null,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
