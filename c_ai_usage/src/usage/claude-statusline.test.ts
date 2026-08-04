import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readStatuslineSlots } from './claude-statusline';

const NOW = Date.parse('2026-08-04T02:00:00Z');

let cacheFile: string;

beforeEach(() => {
  cacheFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'c-ai-usage-')), 'cache.json');
  process.env['C_AI_USAGE_STATUSLINE_CACHE'] = cacheFile;
});

afterEach(() => {
  delete process.env['C_AI_USAGE_STATUSLINE_CACHE'];
});

describe('readStatuslineSlots', () => {
  it('파일이 없으면 null — tier 2 로 넘어가야 한다', async () => {
    expect(await readStatuslineSlots(NOW)).toBeNull();
  });

  it('신선한 캐시에서 두 슬롯을 뽑는다', async () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        writtenAtMs: NOW - 30_000,
        rate_limits: {
          five_hour: { used_percentage: 41, resets_at: 1786192199 },
          seven_day: { used_percentage: 26, resets_at: 1786435199 },
        },
      }),
    );
    const slots = await readStatuslineSlots(NOW);
    expect(slots?.fiveHour?.utilization).toBe(41);
    expect(slots?.week?.utilization).toBe(26);
  });

  it('resets_at 을 epoch 초로 읽는다 — HTTP 응답의 ISO 문자열과 포맷이 다르다', async () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        writtenAtMs: NOW,
        rate_limits: { five_hour: { used_percentage: 10, resets_at: 1786192199 } },
      }),
    );
    const slots = await readStatuslineSlots(NOW);
    expect(slots?.fiveHour?.resetsAtMs).toBe(1786192199 * 1000);
    expect(new Date(slots?.fiveHour?.resetsAtMs ?? 0).getUTCFullYear()).toBe(2026);
  });

  it('낡은 캐시는 null — Claude Code 를 안 쓰는 동안 낡은 값을 보여주면 안 된다', async () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        writtenAtMs: NOW - 120_000,
        rate_limits: { five_hour: { used_percentage: 41 } },
      }),
    );
    expect(await readStatuslineSlots(NOW)).toBeNull();
  });

  it('writtenAtMs 가 없으면 null — 나이를 모르는 캐시는 신뢰하지 않는다', async () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({ rate_limits: { five_hour: { used_percentage: 41 } } }),
    );
    expect(await readStatuslineSlots(NOW)).toBeNull();
  });

  it('rate_limits 가 비면 null', async () => {
    writeFileSync(cacheFile, JSON.stringify({ writtenAtMs: NOW, rate_limits: {} }));
    expect(await readStatuslineSlots(NOW)).toBeNull();
  });

  it('깨진 JSON 은 null', async () => {
    writeFileSync(cacheFile, '{nope');
    expect(await readStatuslineSlots(NOW)).toBeNull();
  });

  it('used_percentage 가 숫자가 아니면 null 로 두고 창은 유지한다', async () => {
    writeFileSync(
      cacheFile,
      JSON.stringify({
        writtenAtMs: NOW,
        rate_limits: { five_hour: { used_percentage: null, resets_at: null } },
      }),
    );
    const slots = await readStatuslineSlots(NOW);
    expect(slots?.fiveHour?.utilization).toBeNull();
  });
});
