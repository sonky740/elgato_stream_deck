import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseUsage } from './claude';
import { assignSlots, type UsageWindow } from './types';

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'fixtures');

const fixture = (name: string): unknown => {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
};

describe('parseUsage', () => {
  it('실측 응답에서 5H · WK 슬롯을 뽑는다', () => {
    const { state, slots } = parseUsage(fixture('claude-usage-200.json'));
    expect(state).toBe('ok');
    expect(slots.fiveHour).toEqual({
      label: '5H',
      durationSec: 18000,
      utilization: 37,
      resetsAtMs: Date.parse('2026-08-04T04:49:59.233339+00:00'),
    });
    expect(slots.week?.label).toBe('WK');
    expect(slots.week?.utilization).toBe(26);
  });

  it('utilization 을 0..100 그대로 읽는다 — 0..1 로 나누지 않는다', () => {
    const { slots } = parseUsage(fixture('claude-usage-200.json'));
    expect(slots.fiveHour?.utilization).toBeGreaterThan(1);
  });

  it('resets_at 을 ISO 문자열로 파싱한다 — epoch 초로 오해하면 1970년이 나온다', () => {
    const { slots } = parseUsage(fixture('claude-usage-200.json'));
    expect(new Date(slots.week?.resetsAtMs ?? 0).getUTCFullYear()).toBe(2026);
  });

  it('여러 weekly 중 가장 binding 한 것을 Week 슬롯에 넣는다', () => {
    const { slots } = parseUsage(fixture('claude-usage-scoped-weekly.json'));
    expect(slots.week?.utilization).toBe(81);
    expect(slots.week?.label).toBe('WK·Opus');
  });

  it('소수점 utilization 을 잃지 않는다', () => {
    const { slots } = parseUsage(fixture('claude-usage-scoped-weekly.json'));
    expect(slots.fiveHour?.utilization).toBe(12.5);
  });

  it('모르는 코드네임 창은 무시한다 — 슬롯을 훔쳐가지 않는다', () => {
    const { slots } = parseUsage(fixture('claude-usage-scoped-weekly.json'));
    expect(slots.fiveHour?.label).toBe('5H');
    expect(slots.week?.label).toBe('WK·Opus');
  });

  it('null 창은 슬롯을 차지하지 않는다', () => {
    const { slots } = parseUsage(fixture('claude-usage-200.json'));
    expect(slots.week?.label).not.toContain('Sonnet');
  });

  it('빈 본문은 0% 가 아니라 unentitled 다', () => {
    const { state, slots } = parseUsage(fixture('claude-usage-unentitled.json'));
    expect(state).toBe('unentitled');
    expect(slots.fiveHour).toBeNull();
    expect(slots.week).toBeNull();
  });

  it('객체가 아닌 본문은 shape-changed 다', () => {
    expect(parseUsage(null).state).toBe('shape-changed');
    expect(parseUsage([1, 2]).state).toBe('shape-changed');
  });

  it('utilization 이 숫자가 아니면 null 로 두고 창은 유지한다', () => {
    const { state, slots } = parseUsage({ five_hour: { utilization: null, resets_at: null } });
    expect(state).toBe('ok');
    expect(slots.fiveHour?.utilization).toBeNull();
  });
});

describe('assignSlots', () => {
  const win = (durationSec: number, utilization: number | null, label = 'x'): UsageWindow => ({
    label,
    durationSec,
    utilization,
    resetsAtMs: null,
  });

  it('창 길이를 범위로 버킷팅한다 — 정확히 300분/10080분을 요구하지 않는다', () => {
    const slots = assignSlots([win(4 * 3600, 10, 'FOUR'), win(6 * 24 * 3600, 20, 'SIX_DAY')]);
    expect(slots.fiveHour?.label).toBe('FOUR');
    expect(slots.week?.label).toBe('SIX_DAY');
  });

  it('durationSec 0 은 어느 슬롯에도 넣지 않는다', () => {
    expect(assignSlots([win(0, 99)])).toEqual({ fiveHour: null, week: null });
  });

  it('두 버킷 사이(2일)에 걸치는 길이는 버린다', () => {
    expect(assignSlots([win(2 * 24 * 3600, 50)])).toEqual({ fiveHour: null, week: null });
  });

  it('utilization null 은 값 있는 창에 밀린다', () => {
    const slots = assignSlots([win(604800, null, 'UNKNOWN'), win(604800, 3, 'KNOWN')]);
    expect(slots.week?.label).toBe('KNOWN');
  });

  it('전부 null 이면 그래도 창 하나는 남긴다 — 슬롯 공란과 구분되어야 한다', () => {
    const slots = assignSlots([win(604800, null, 'UNKNOWN')]);
    expect(slots.week?.label).toBe('UNKNOWN');
    expect(slots.week?.utilization).toBeNull();
  });
});
