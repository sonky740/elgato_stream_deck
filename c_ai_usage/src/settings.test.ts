import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CRIT_AT,
  DEFAULT_POLL_SEC,
  DEFAULT_WARN_AT,
  MAX_POLL_SEC,
  MIN_POLL_SEC,
  resolveBasis,
  resolveChart,
  resolvePollMs,
  resolveThresholds,
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

describe('resolveThresholds', () => {
  const D = { warnAt: DEFAULT_WARN_AT, critAt: DEFAULT_CRIT_AT };

  it('없으면 기본값 — PI 도입으로 기존 사용자의 색이 바뀌면 안 된다', () => {
    expect(resolveThresholds(undefined)).toEqual(D);
    expect(resolveThresholds({})).toEqual(D);
  });

  it('유효한 값을 그대로 쓴다', () => {
    expect(resolveThresholds({ warnAt: 60, critAt: 85 })).toEqual({ warnAt: 60, critAt: 85 });
  });

  it('문자열 숫자를 받아들인다 — PI 입력이 문자열로 올 수 있다', () => {
    expect(resolveThresholds({ warnAt: '70' as never, critAt: '90' as never })).toEqual({
      warnAt: 70,
      critAt: 90,
    });
  });

  it('한쪽만 설정하면 나머지는 기본값이다', () => {
    expect(resolveThresholds({ warnAt: 50 })).toEqual({ warnAt: 50, critAt: DEFAULT_CRIT_AT });
    expect(resolveThresholds({ critAt: 90 })).toEqual({ warnAt: DEFAULT_WARN_AT, critAt: 90 });
  });

  /**
   * `Number('')` 과 `Number(null)` 이 **0** 이다. 0 을 범위 clamp 로만 처리하면 하한 1% 가 되어
   * 화면 전체가 경고색이 된다 — 빈 값이 "임계 0%" 로 해석되는 경로를 막는다.
   */
  it('숫자가 아니거나 0 이하면 기본값 — 빈 값이 임계 0% 가 되면 안 된다', () => {
    for (const bad of [NaN, 'abc', '', null, 0, -5] as never[]) {
      expect(resolveThresholds({ warnAt: bad, critAt: bad })).toEqual(D);
    }
  });

  it('범위를 벗어나면 1~100 으로 clamp 한다', () => {
    expect(resolveThresholds({ warnAt: 0.4, critAt: 150 })).toEqual({ warnAt: 1, critAt: 100 });
  });

  /**
   * 두 드롭다운이 서로를 모르므로 뒤집힌 조합은 UI 로도 만들 수 있다. critAt 이 authoritative 다 —
   * "85%에 빨강" 을 골랐으면 그 위에 amber 자리가 없으므로 **amber 단계가 사라진다**(색 변화가
   * 아니라 경고 단계 하나를 잃는 것이라 여기서 명시적으로 고정한다).
   */
  it('warn 이 crit 보다 높으면 crit 까지 끌어내린다 — amber 단계가 사라진다', () => {
    expect(resolveThresholds({ warnAt: 90, critAt: 85 })).toEqual({ warnAt: 85, critAt: 85 });
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
