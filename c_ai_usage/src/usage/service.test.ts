import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeSource } from './claude';
import { CodexSource } from './codex';
import { createUsageService, type UsageService } from './service';
import type { FetchResult, LimitsSource, SourceState, UsageViewModel } from './types';

vi.mock('@elgato/streamdeck', () => ({
  default: { logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));

const INTERVAL = 300_000;
const STALE_LIMIT = 30 * 60_000;
/** 수동 새로고침의 최소 간격(service.ts 의 MANUAL_MIN_GAP_MS 와 같은 값). */
const MANUAL_GAP = 60_000;
/** 첫 fetch 의 jitter 상한(service.ts 와 같은 값). 이 시간을 넘기면 확실히 발화한다. */
const JITTER = 5000;

const OK_SLOTS: FetchResult = {
  state: 'ok',
  slots: {
    fiveHour: { label: '5H', durationSec: 18000, utilization: 37, resetsAtMs: null },
    week: { label: 'WK', durationSec: 604800, utilization: 26, resetsAtMs: null },
  },
};

/** 요청을 만들지 않는 실패. 자격증명 만료 선판정이 내는 결과다. */
const EXPIRED: FetchResult = { state: 'expired', slots: { fiveHour: null, week: null } };

const fakeSource = (results: FetchResult[]): LimitsSource & { calls: number } => {
  let i = 0;
  return {
    provider: 'claude',
    calls: 0,
    async fetch(this: { calls: number }) {
      this.calls += 1;
      return results[Math.min(i++, results.length - 1)] ?? OK_SLOTS;
    },
  };
};

const collect = (
  source: LimitsSource,
): {
  seen: UsageViewModel[];
  off: () => void;
  service: UsageService;
} => {
  const seen: UsageViewModel[] = [];
  const service = createUsageService(source, { intervalMs: INTERVAL, staleLimitMs: STALE_LIMIT });
  const off = service.subscribe((vm) => seen.push(vm));
  return { seen, off, service };
};

/** jitter 를 넘겨 첫 fetch 를 발화시키고 마이크로태스크까지 흘린다. */
const firstFetch = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(JITTER + 1);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('실패는 폴링 간격을 절대 짧게 만들지 않는다 — 과거 폭주 사고의 핵심', async () => {
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

  it('간격이 백오프 상한보다 길어도 실패 뒤 대기는 간격 아래로 내려가지 않는다 — 60분 간격에서 30분 상한이 재요청을 당기지 않게', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const hour = 60 * 60_000;
    const source = fakeSource([{ state: 'network', slots: { fiveHour: null, week: null } }]);
    const service = createUsageService(source, { intervalMs: hour, staleLimitMs: STALE_LIMIT });
    service.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(hour - 2);
    expect(source.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
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

  it.each<SourceState>(['no-credential', 'expired', 'revoked', 'forbidden'])(
    '자격증명 실패(%s)는 상한 없이 정상 간격으로 다시 확인한다 — 같은 토큰으로는 소스가 요청하지 않는다',
    async (state) => {
      const source = fakeSource([{ state, slots: { fiveHour: null, week: null } }]);
      collect(source);
      await firstFetch();
      // network 실패였다면 첫 재요청부터 interval*2 를 기다린다. 옛 상한(3회)도 넘긴다.
      for (let i = 1; i <= 10; i += 1) {
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(source.calls).toBe(1 + i);
      }
    },
  );

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

  it('실패 중에는 대기를 다시 잡지 않는다 — 백오프가 짧아지면 폭주 경로가 다시 열린다', async () => {
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

  it('앞선 요청 실패가 있어도 자격증명 실패 중에는 새 간격이 바로 적용된다 — 짧아질 백오프 대기가 없다', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const source = fakeSource([
      { state: 'network', slots: { fiveHour: null, week: null } },
      EXPIRED,
    ]);
    const { service } = collect(source);
    await vi.advanceTimersByTimeAsync(1);
    // network 뒤 대기(INTERVAL*2)를 지나 expired 가 오고, 다음 재확인은 INTERVAL 뒤로 잡힌다.
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(source.calls).toBe(2);

    service.setIntervalMs(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(source.calls).toBe(3);
  });
});

describe('refresh (PI 수동 새로고침)', () => {
  it('쿨다운을 넘겼으면 갱신 주기를 기다리지 않고 즉시 읽어온다', async () => {
    const source = fakeSource([OK_SLOTS]);
    const { service } = collect(source);
    await firstFetch();
    await vi.advanceTimersByTimeAsync(MANUAL_GAP);

    service.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(2);
  });

  it('쿨다운 안에서는 아무것도 하지 않는다 — 연타로 요청률을 올릴 수 없다', async () => {
    const source = fakeSource([OK_SLOTS]);
    const { service } = collect(source);
    await firstFetch();

    service.refresh();
    service.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(1);
  });

  it('실패 백오프를 앞당기지 않는다 — 실패가 요청 빈도를 올리는 경로를 수동에도 열지 않는다', async () => {
    const source = fakeSource([{ state: 'network', slots: { fiveHour: null, week: null } }]);
    const { service } = collect(source);
    await firstFetch();
    // 첫 실패 뒤 대기는 interval*2 다. 쿨다운(60s)만 넘겨서 눌러도 재요청이 없어야 한다.
    await vi.advanceTimersByTimeAsync(MANUAL_GAP);
    service.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(1);
    // 원래 백오프 tick 은 그대로 남아 있다 — refresh 가 타이머를 건드리지 않았다.
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(source.calls).toBe(2);
  });

  it('로컬 실패 중에는 버튼이 열려 있다 — 재로그인으로 이미 고쳐진 상태를 백오프로 가두지 않는다', async () => {
    const source = fakeSource([EXPIRED]);
    const { service } = collect(source);
    await firstFetch();
    await vi.advanceTimersByTimeAsync(MANUAL_GAP);
    service.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(2);
  });

  it('로컬 실패가 오래 이어져도 버튼이 열려 있다 — 밤새 만료된 토큰을 아침에 재로그인하는 경로다', async () => {
    const source = fakeSource([EXPIRED]);
    const { service } = collect(source);
    await firstFetch();
    // 3회 재확인 + 서킷 진입(연속 4회)을 넉넉히 넘긴다. 실측 사고에서는 45시간이었다.
    await vi.advanceTimersByTimeAsync(INTERVAL * 20);
    const before = source.calls;
    await vi.advanceTimersByTimeAsync(MANUAL_GAP);
    service.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(before + 1);
  });

  it('앞선 요청 실패가 있어도 자격증명 실패 중에는 버튼이 열려 있다 — 깨어날 때 한 번 끊긴 네트워크가 재로그인을 막지 않게', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const source = fakeSource([
      { state: 'network', slots: { fiveHour: null, week: null } },
      EXPIRED,
    ]);
    const { service } = collect(source);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    const before = source.calls;
    await vi.advanceTimersByTimeAsync(MANUAL_GAP);
    service.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(before + 1);
  });

  it('수동 fetch 뒤 다음 자동 폴링은 그 시점부터 다시 센다 — 수동도 성공한 fetch 다', async () => {
    // jitter 를 0 으로 고정한다. 흔들리면 "원래 tick" 과 "수동 이후 tick" 을 시각으로 구분할 수
    // 없어, 옛 타이머가 남아 있는 구현도 통과한다.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const source = fakeSource([OK_SLOTS]);
    const { service } = collect(source);
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(MANUAL_GAP);
    service.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(source.calls).toBe(2);

    // 원래 tick(t=INTERVAL)을 지났다 — 그게 살아 있으면 여기서 3 이 된다.
    await vi.advanceTimersByTimeAsync(INTERVAL - MANUAL_GAP);
    expect(source.calls).toBe(2);
    // 수동 fetch 시점 + INTERVAL 을 넘기면 다시 돈다.
    await vi.advanceTimersByTimeAsync(MANUAL_GAP);
    expect(source.calls).toBe(3);
  });
});

describe('거부 토큰 합성 (서비스 + 실제 소스)', () => {
  // 가짜 소스는 요청을 모델링하지 않는다 — 규칙 10 의 요청률은 서비스와 소스가 함께 있어야 성립한다.
  beforeEach(() => {
    // 실제 소스는 파일을 읽는다. 가짜 타이머 전체를 쓰면 I/O 를 기다리지 않고 시간만 흘러 폴링이 1회로 끝난다.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'c-ai-usage-compose-'));
    const payload = Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url');
    writeFileSync(
      path.join(dir, 'auth.json'),
      JSON.stringify({ tokens: { access_token: `eyJhbGciOiJSUzI1NiJ9.${payload}.sig` } }),
    );
    process.env['CODEX_HOME'] = dir;
    process.env['CLAUDE_CODE_OAUTH_TOKEN'] = 'sk-ant-oat01-compose-token';
    process.env['C_AI_USAGE_STATUSLINE_CACHE'] = path.join(dir, 'no-cache.json');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
          ),
        ),
    );
  });
  afterEach(() => {
    delete process.env['CODEX_HOME'];
    delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    delete process.env['C_AI_USAGE_STATUSLINE_CACHE'];
    vi.unstubAllGlobals();
  });

  /** 폴링 하나가 끝나 emit 할 때까지 실제 이벤트 루프를 돌린다. */
  const until = async (done: () => boolean): Promise<void> => {
    for (let i = 0; i < 1000 && !done(); i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(done()).toBe(true);
  };

  it.each([
    ['codex', (): LimitsSource => new CodexSource()],
    ['claude', (): LimitsSource => new ClaudeSource()],
  ])('%s: 거부된 토큰은 1시간 폴링하는 동안 15분에 한 번만 다시 보낸다', async (_name, make) => {
    const { seen } = collect(make());
    // 0분부터 60분까지 폴링 13회. 요청은 0·15·30·45·60분의 5회뿐이다 — 배선이 빠지면 13회가 된다.
    for (let poll = 1; poll <= 13; poll += 1) {
      await vi.advanceTimersByTimeAsync(poll === 1 ? 1 : INTERVAL);
      // seen[0] 은 구독 즉시의 loading 이다.
      await until(() => seen.length > poll);
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
  });
});
