import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUsageService } from './service';
import type { FetchResult, LimitsSource, SourceState, UsageViewModel } from './types';

vi.mock('@elgato/streamdeck', () => ({
  default: { logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));

const INTERVAL = 300_000;
const STALE_LIMIT = 30 * 60_000;
/** 첫 fetch 의 jitter 상한(service.ts 와 같은 값). 이 시간을 넘기면 확실히 발화한다. */
const JITTER = 5000;

const OK_SLOTS: FetchResult = {
  state: 'ok',
  slots: {
    fiveHour: { label: '5H', durationSec: 18000, utilization: 37, resetsAtMs: null },
    week: { label: 'WK', durationSec: 604800, utilization: 26, resetsAtMs: null },
  },
};

function fakeSource(results: FetchResult[]): LimitsSource & { calls: number } {
  let i = 0;
  return {
    provider: 'claude',
    calls: 0,
    async fetch(this: { calls: number }) {
      this.calls += 1;
      return results[Math.min(i++, results.length - 1)] ?? OK_SLOTS;
    },
  };
}

function collect(source: LimitsSource): { seen: UsageViewModel[]; off: () => void } {
  const seen: UsageViewModel[] = [];
  const service = createUsageService(source, { intervalMs: INTERVAL, staleLimitMs: STALE_LIMIT });
  const off = service.subscribe((vm) => seen.push(vm));
  return { seen, off };
}

/** jitter 를 넘겨 첫 fetch 를 발화시키고 마이크로태스크까지 흘린다. */
async function firstFetch(): Promise<void> {
  await vi.advanceTimersByTimeAsync(JITTER + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createUsageService', () => {
  it('구독 즉시 loading 을 한 번 준다 — 첫 fetch 전에도 그릴 것이 있어야 한다', () => {
    const { seen } = collect(fakeSource([OK_SLOTS]));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.state).toBe('loading');
  });

  it('첫 fetch 성공 후 ok 와 슬롯을 준다', async () => {
    const { seen } = collect(fakeSource([OK_SLOTS]));
    await firstFetch();
    expect(seen.at(-1)?.state).toBe('ok');
    expect(seen.at(-1)?.slots.fiveHour?.utilization).toBe(37);
    expect(seen.at(-1)?.fetchedAtMs).not.toBeNull();
  });

  it('성공 후에는 정확히 interval 뒤에 다시 폴링한다', async () => {
    const source = fakeSource([OK_SLOTS]);
    collect(source);
    await firstFetch();
    expect(source.calls).toBe(1);
    // 첫 fetch 는 0..JITTER 사이 임의 시점에 일어나므로 그 폭을 양쪽에서 빼고 더해 판정한다.
    await vi.advanceTimersByTimeAsync(INTERVAL - JITTER - 10);
    expect(source.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(JITTER + 20);
    expect(source.calls).toBe(2);
  });

  it('429 는 마지막 성공값을 나이와 함께 유지한다 — 에러로 취급하지 않는다', async () => {
    const source = fakeSource([
      OK_SLOTS,
      { state: 'throttled', slots: { fiveHour: null, week: null } },
    ]);
    const { seen } = collect(source);
    await firstFetch();
    await vi.advanceTimersByTimeAsync(INTERVAL + 1);
    const last = seen.at(-1);
    expect(last?.state).toBe('stale');
    expect(last?.slots.fiveHour?.utilization).toBe(37);
  });

  it('마지막 성공값이 없으면 429 를 그대로 드러낸다', async () => {
    const { seen } = collect(
      fakeSource([{ state: 'throttled', slots: { fiveHour: null, week: null } }]),
    );
    await firstFetch();
    expect(seen.at(-1)?.state).toBe('throttled');
  });

  it('사용자 조치가 필요한 실패는 마지막 성공값으로 덮지 않는다', async () => {
    const hard: SourceState[] = [
      'no-credential',
      'expired',
      'revoked',
      'forbidden',
      'unentitled',
      'blocked',
    ];
    for (const state of hard) {
      const source = fakeSource([OK_SLOTS, { state, slots: { fiveHour: null, week: null } }]);
      const { seen, off } = collect(source);
      await firstFetch();
      await vi.advanceTimersByTimeAsync(INTERVAL + 1);
      expect(seen.at(-1)?.state, state).toBe(state);
      off();
    }
  });

  it('오래된 마지막 성공값은 stale 로 보여주지 않는다', async () => {
    const source = fakeSource([
      OK_SLOTS,
      { state: 'network', slots: { fiveHour: null, week: null } },
    ]);
    const { seen } = collect(source);
    await firstFetch();
    // staleLimit 를 넘길 만큼 실패를 반복시킨다.
    await vi.advanceTimersByTimeAsync(STALE_LIMIT + INTERVAL * 4);
    expect(seen.at(-1)?.state).toBe('network');
  });

  it('실패는 폴링 간격을 절대 짧게 만들지 않는다 — §0 사고의 핵심', async () => {
    const source = fakeSource([{ state: 'network', slots: { fiveHour: null, week: null } }]);
    collect(source);
    await firstFetch();
    expect(source.calls).toBe(1);
    // 첫 실패 뒤 대기는 interval*2 다. interval 만 지나도 재요청이 없어야 한다.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(source.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(INTERVAL + 1);
    expect(source.calls).toBe(2);
  });

  it('연속 실패가 쌓이면 요청 간격이 단조 증가한다', async () => {
    const source = fakeSource([{ state: 'network', slots: { fiveHour: null, week: null } }]);
    collect(source);
    await firstFetch();
    const gaps: number[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const before = source.calls;
      let waited = 0;
      while (source.calls === before && waited < 60 * 60_000) {
        await vi.advanceTimersByTimeAsync(30_000);
        waited += 30_000;
      }
      gaps.push(waited);
    }
    expect(gaps[1]).toBeGreaterThanOrEqual(gaps[0] ?? 0);
    expect(gaps[2]).toBeGreaterThanOrEqual(gaps[1] ?? 0);
  });

  it('구독이 끊기면 폴링을 멈춘다', async () => {
    const source = fakeSource([OK_SLOTS]);
    const { off } = collect(source);
    await firstFetch();
    expect(source.calls).toBe(1);
    off();
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(source.calls).toBe(1);
  });

  it('구독자가 여럿이어도 요청은 하나다 — 인스턴스 수가 요청률에 영향을 주지 않는다', async () => {
    const source = fakeSource([OK_SLOTS]);
    const service = createUsageService(source, { intervalMs: INTERVAL, staleLimitMs: STALE_LIMIT });
    const seenA: UsageViewModel[] = [];
    const seenB: UsageViewModel[] = [];
    service.subscribe((vm) => seenA.push(vm));
    service.subscribe((vm) => seenB.push(vm));
    await firstFetch();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3 + 1);
    // 구독자가 2명이어도 3주기 동안 요청은 4회 이하다. 곱해지면 8회가 된다.
    expect(source.calls).toBeLessThanOrEqual(4);
    expect(seenA.at(-1)?.state).toBe('ok');
    expect(seenB.at(-1)?.state).toBe('ok');
  });

  it('어댑터가 throw 해도 서비스가 죽지 않는다', async () => {
    const source: LimitsSource = {
      provider: 'claude',
      fetch: () => Promise.reject(new Error('boom')),
    };
    const { seen } = collect(source);
    await firstFetch();
    expect(seen.at(-1)?.state).toBe('network');
  });
});

describe('setIntervalMs', () => {
  it('성공 상태에서 간격을 줄이면 다음 폴링이 새 간격으로 온다', async () => {
    const source = fakeSource([OK_SLOTS]);
    const service = createUsageService(source, { intervalMs: INTERVAL, staleLimitMs: STALE_LIMIT });
    const off = service.subscribe(() => {});
    await firstFetch();
    expect(source.calls).toBe(1);

    service.setIntervalMs(60_000);
    await vi.advanceTimersByTimeAsync(60_000 + JITTER + 20);
    expect(source.calls).toBe(2);
    off();
  });

  it('같은 값이면 아무것도 하지 않는다 — 재스케줄로 대기가 리셋되지 않게', async () => {
    const source = fakeSource([OK_SLOTS]);
    const service = createUsageService(source, { intervalMs: INTERVAL, staleLimitMs: STALE_LIMIT });
    const off = service.subscribe(() => {});
    await firstFetch();
    // interval 직전까지 진행한 뒤 같은 값으로 호출해도 대기가 늘어나선 안 된다.
    await vi.advanceTimersByTimeAsync(INTERVAL - JITTER - 10);
    service.setIntervalMs(INTERVAL);
    await vi.advanceTimersByTimeAsync(JITTER + 20);
    expect(source.calls).toBe(2);
    off();
  });

  it('실패 중에는 대기를 다시 잡지 않는다 — 백오프가 짧아지면 §0 사고 경로가 다시 열린다', async () => {
    const source = fakeSource([{ state: 'network', slots: { fiveHour: null, week: null } }]);
    const service = createUsageService(source, { intervalMs: INTERVAL, staleLimitMs: STALE_LIMIT });
    const off = service.subscribe(() => {});
    await firstFetch();
    expect(source.calls).toBe(1);

    // 실패 1회 후 대기는 INTERVAL*2 다. 여기서 간격을 60s 로 줄여도 그 대기가 짧아지면 안 된다.
    service.setIntervalMs(60_000);
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(source.calls).toBe(1);
    off();
  });
});
