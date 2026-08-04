import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexSource, parseUsage } from './codex';

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'fixtures');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
}

describe('parseUsage (codex)', () => {
  it('실측 응답에서 주간 창만 뽑고 5HR 슬롯은 공란으로 둔다', () => {
    const { state, slots } = parseUsage(fixture('codex-usage-200.json'));
    expect(state).toBe('ok');
    // 2026-07-13 이후 OpenAI 가 주간 창만 반환한다 — 공란이 정상이다.
    expect(slots.fiveHour).toBeNull();
    expect(slots.week?.utilization).toBe(18);
    expect(slots.week?.label).toBe('WK');
    expect(slots.week?.durationSec).toBe(604800);
  });

  it('used_percent 를 0..100 그대로 읽는다', () => {
    const { slots } = parseUsage(fixture('codex-usage-200.json'));
    expect(slots.week?.utilization).toBeGreaterThan(1);
  });

  it('reset_at 을 epoch 초로 읽는다 — ms 로 오해하면 1970년이 나온다', () => {
    const { slots } = parseUsage(fixture('codex-usage-200.json'));
    expect(slots.week?.resetsAtMs).toBe(1786178120 * 1000);
    expect(new Date(slots.week?.resetsAtMs ?? 0).getUTCFullYear()).toBe(2026);
  });

  it('창이 2개면 길이로 슬롯을 가른다 — 슬롯 위치가 아니다', () => {
    const { slots } = parseUsage(fixture('codex-usage-two-windows.json'));
    expect(slots.fiveHour?.utilization).toBe(64);
    expect(slots.fiveHour?.label).toBe('5H');
    expect(slots.week?.utilization).toBe(31);
    expect(slots.week?.label).toBe('WK');
  });

  it('primary 에 주간 창이 와도 주간 슬롯에 들어간다 — 2026-07 이후 실제 모양', () => {
    const { slots } = parseUsage({
      rate_limit: {
        primary_window: { used_percent: 42, limit_window_seconds: 604800, reset_at: 1786178120 },
        secondary_window: null,
      },
    });
    expect(slots.week?.utilization).toBe(42);
    expect(slots.fiveHour).toBeNull();
  });

  it('반대로 primary 에 5시간 창이 오던 과거 모양도 올바르게 간다', () => {
    const { slots } = parseUsage({
      rate_limit: { primary_window: { used_percent: 55, limit_window_seconds: 18000 } },
    });
    expect(slots.fiveHour?.utilization).toBe(55);
    expect(slots.fiveHour?.label).toBe('5H');
    expect(slots.week).toBeNull();
  });

  it('rate_limit 이 없으면 shape-changed', () => {
    expect(parseUsage({ plan_type: 'plus' }).state).toBe('shape-changed');
    expect(parseUsage(null).state).toBe('shape-changed');
  });

  it('창이 둘 다 null 이면 0% 가 아니라 unentitled', () => {
    const { state, slots } = parseUsage({
      rate_limit: { allowed: true, primary_window: null, secondary_window: null },
    });
    expect(state).toBe('unentitled');
    expect(slots.week).toBeNull();
  });

  it('limit_window_seconds 가 없거나 0이면 그 창을 버린다', () => {
    expect(parseUsage({ rate_limit: { primary_window: { used_percent: 9 } } }).state).toBe(
      'unentitled',
    );
    expect(
      parseUsage({ rate_limit: { primary_window: { used_percent: 9, limit_window_seconds: 0 } } })
        .state,
    ).toBe('unentitled');
  });

  it('used_percent 가 숫자가 아니면 null 로 두고 창은 유지한다', () => {
    const { state, slots } = parseUsage({
      rate_limit: { primary_window: { used_percent: null, limit_window_seconds: 604800 } },
    });
    expect(state).toBe('ok');
    expect(slots.week?.utilization).toBeNull();
  });

  it('버킷 경계 밖 길이는 사람이 읽을 라벨을 얻지만 슬롯엔 안 들어간다', () => {
    const { state, slots } = parseUsage({
      rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 2 * 24 * 3600 } },
    });
    expect(state).toBe('ok');
    expect(slots.fiveHour).toBeNull();
    expect(slots.week).toBeNull();
  });

  it('PII 를 뷰모델로 흘리지 않는다 — 응답엔 email·user_id 가 평문으로 온다', () => {
    const body = { ...(fixture('codex-usage-200.json') as object), email: 'someone@example.test' };
    const dumped = JSON.stringify(parseUsage(body));
    expect(dumped).not.toContain('example.test');
    expect(dumped).not.toContain('email');
  });
});

describe('CodexSource', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'c-ai-usage-codex-'));
    process.env['CODEX_HOME'] = home;
  });

  afterEach(() => {
    delete process.env['CODEX_HOME'];
    vi.unstubAllGlobals();
  });

  /** exp 를 미래로 둔 JWT. 서명은 검증하지 않으므로 형식만 맞으면 된다. */
  function jwt(expSec: number): string {
    const payload = Buffer.from(JSON.stringify({ exp: expSec }), 'utf8').toString('base64url');
    return `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
  }

  function writeAuth(expSec: number): void {
    writeFileSync(
      path.join(home, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: { access_token: jwt(expSec), account_id: 'acct-1' },
      }),
    );
  }

  it('auth.json 이 없으면 요청하지 않고 no-credential', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect((await new CodexSource().fetch()).state).toBe('no-credential');
    expect(spy).not.toHaveBeenCalled();
  });

  it('JWT exp 가 지났으면 요청하지 않고 expired — auth.json 에 만료 필드가 없다', async () => {
    writeAuth(Math.floor(Date.now() / 1000) - 60);
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect((await new CodexSource().fetch()).state).toBe('expired');
    expect(spy).not.toHaveBeenCalled();
  });

  it('wham 경로로 요청하고 계정 헤더·자기 UA 를 싣는다', async () => {
    writeAuth(Math.floor(Date.now() / 1000) + 3600);
    const spy = vi.fn().mockResolvedValue(
      new Response(readFileSync(path.join(FIXTURES, 'codex-usage-200.json'), 'utf8'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', spy);
    const res = await new CodexSource().fetch();
    const [url, opts] = spy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(url).not.toContain('/api/codex/usage');
    expect(opts.headers['ChatGPT-Account-Id']).toBe('acct-1');
    expect(opts.headers['User-Agent']).toContain('c-ai-usage/');
    expect(res.state).toBe('ok');
  });

  it('Cloudflare 챌린지를 blocked 로 되돌린다 — JSON 으로 파싱하지 않는다', async () => {
    writeAuth(Math.floor(Date.now() / 1000) + 3600);
    const html = readFileSync(path.join(FIXTURES, 'codex-cloudflare-challenge.html'), 'utf8');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(html, { status: 403, headers: { 'content-type': 'text/html' } }),
        ),
    );
    expect((await new CodexSource().fetch()).state).toBe('blocked');
  });
});
