import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLL_SEC,
  MAX_POLL_SEC,
  MIN_POLL_SEC,
  resolveBasis,
  resolveChart,
  resolvePollMs,
} from './settings';

describe('resolveChart / resolveBasis', () => {
  it('설정이 없으면 v1 동작과 같은 기본값 — PI 도입으로 화면이 바뀌면 안 된다', () => {
    expect(resolveChart(undefined)).toBe('donut');
    expect(resolveBasis(undefined)).toBe('used');
    expect(resolveChart({})).toBe('donut');
    expect(resolveBasis({})).toBe('used');
  });

  it('유효한 값을 그대로 쓴다', () => {
    expect(resolveChart({ chart: 'bar' })).toBe('bar');
    expect(resolveBasis({ basis: 'remaining' })).toBe('remaining');
  });

  it('알 수 없는 값은 기본값으로 떨어진다 — 설정은 사용자가 만질 수 있는 평문 JSON 이다', () => {
    expect(resolveChart({ chart: 'pie' as never })).toBe('donut');
    expect(resolveBasis({ basis: '' as never })).toBe('used');
    expect(resolveChart({ chart: null as never })).toBe('donut');
  });
});

describe('resolvePollMs', () => {
  it('없거나 숫자가 아니면 기본값', () => {
    expect(resolvePollMs(undefined)).toBe(DEFAULT_POLL_SEC * 1000);
    expect(resolvePollMs({})).toBe(DEFAULT_POLL_SEC * 1000);
    expect(resolvePollMs({ pollIntervalSec: NaN })).toBe(DEFAULT_POLL_SEC * 1000);
    expect(resolvePollMs({ pollIntervalSec: 'abc' as never })).toBe(DEFAULT_POLL_SEC * 1000);
  });

  it('문자열 숫자를 받아들인다 — PI 입력이 문자열로 올 수 있다', () => {
    expect(resolvePollMs({ pollIntervalSec: '600' as never })).toBe(600_000);
  });

  it('하한 아래로 못 내려간다 — 그보다 짧게 열면 레이트리밋 사고를 재현할 수 있다', () => {
    expect(resolvePollMs({ pollIntervalSec: 1 })).toBe(MIN_POLL_SEC * 1000);
    expect(resolvePollMs({ pollIntervalSec: 0 })).toBe(MIN_POLL_SEC * 1000);
    expect(resolvePollMs({ pollIntervalSec: -100 })).toBe(MIN_POLL_SEC * 1000);
  });

  it('상한을 넘지 못한다', () => {
    expect(resolvePollMs({ pollIntervalSec: 99_999 })).toBe(MAX_POLL_SEC * 1000);
    expect(resolvePollMs({ pollIntervalSec: Infinity })).toBe(DEFAULT_POLL_SEC * 1000);
  });

  it('하한이 게이트 2 실측 근거값(60s)이다', () => {
    expect(MIN_POLL_SEC).toBe(60);
  });
});
