import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeSource } from './claude';

vi.mock('@elgato/streamdeck', () => ({
  default: { logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'fixtures');

let statuslineCache: string;

/** 실제 키체인을 건드리지 않고 자격증명을 주기 위해 env 오버라이드를 쓴다. */
const FAKE_TOKEN = 'sk-ant-oat01-test-token-value';

const stubFetch = (
  body: string,
  init: { status?: number; contentType?: string } = {},
): ReturnType<typeof vi.fn> => {
  const spy = vi.fn().mockResolvedValue(
    new Response(body, {
      status: init.status ?? 200,
      headers: { 'content-type': init.contentType ?? 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
};

beforeEach(() => {
  statuslineCache = path.join(mkdtempSync(path.join(os.tmpdir(), 'c-ai-usage-src-')), 'cache.json');
  process.env['C_AI_USAGE_STATUSLINE_CACHE'] = statuslineCache;
  process.env['CLAUDE_CODE_OAUTH_TOKEN'] = FAKE_TOKEN;
});

afterEach(() => {
  delete process.env['C_AI_USAGE_STATUSLINE_CACHE'];
  delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ClaudeSource 2단 읽기', () => {
  it('tier 1 캐시가 신선하면 네트워크를 타지 않는다', async () => {
    writeFileSync(
      statuslineCache,
      JSON.stringify({
        writtenAtMs: Date.now(),
        rate_limits: { five_hour: { used_percentage: 41 }, seven_day: { used_percentage: 26 } },
      }),
    );
    const spy = stubFetch('{}');
    const res = await new ClaudeSource().fetch();
    expect(spy).not.toHaveBeenCalled();
    expect(res.state).toBe('ok');
    expect(res.slots.fiveHour?.utilization).toBe(41);
  });

  it('tier 1 이 낡으면 tier 2 로 넘어간다', async () => {
    writeFileSync(
      statuslineCache,
      JSON.stringify({
        writtenAtMs: Date.now() - 200_000,
        rate_limits: { five_hour: { used_percentage: 41 } },
      }),
    );
    const spy = stubFetch(readFileSync(path.join(FIXTURES, 'claude-usage-200.json'), 'utf8'));
    const res = await new ClaudeSource().fetch();
    expect(spy).toHaveBeenCalledOnce();
    // tier 2 의 값(37)이지 tier 1 의 값(41)이 아니다.
    expect(res.slots.fiveHour?.utilization).toBe(37);
  });

  it('tier 1 파일이 아예 없어도 tier 2 로 동작한다', async () => {
    const spy = stubFetch(readFileSync(path.join(FIXTURES, 'claude-usage-200.json'), 'utf8'));
    const res = await new ClaudeSource().fetch();
    expect(spy).toHaveBeenCalledOnce();
    expect(res.state).toBe('ok');
  });

  it('tier 2 요청에 자기 UA 와 oauth beta 헤더를 싣는다', async () => {
    const spy = stubFetch(readFileSync(path.join(FIXTURES, 'claude-usage-200.json'), 'utf8'));
    await new ClaudeSource().fetch();
    const [url, opts] = spy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(opts.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(opts.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(opts.headers['User-Agent']).toContain('c-ai-usage/');
  });

  it('자격증명이 없으면 요청하지 않고 no-credential 이다', async () => {
    delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    // 키체인/파일 경로를 빈 디렉토리로 돌려 자격증명이 없는 상태를 만든다.
    process.env['CLAUDE_CONFIG_DIR'] = mkdtempSync(path.join(os.tmpdir(), 'c-ai-usage-nocred-'));
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const spy = stubFetch('{}');
    try {
      const res = await new ClaudeSource().fetch();
      expect(spy).not.toHaveBeenCalled();
      expect(res.state).toBe('no-credential');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      delete process.env['CLAUDE_CONFIG_DIR'];
    }
  });

  it('429 를 throttled 로 되돌린다 — throw 하지 않는다', async () => {
    stubFetch(readFileSync(path.join(FIXTURES, 'claude-usage-429.json'), 'utf8'), { status: 429 });
    expect((await new ClaudeSource().fetch()).state).toBe('throttled');
  });

  it('빈 본문을 unentitled 로 되돌린다', async () => {
    stubFetch(readFileSync(path.join(FIXTURES, 'claude-usage-unentitled.json'), 'utf8'));
    expect((await new ClaudeSource().fetch()).state).toBe('unentitled');
  });

  describe('거부 토큰 기억', () => {
    /** 호출마다 새 Response 를 준다 — 같은 인스턴스는 본문을 한 번만 읽을 수 있다. */
    const stub401 = (): ReturnType<typeof vi.fn> => {
      const spy = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
          ),
        );
      vi.stubGlobal('fetch', spy);
      return spy;
    };

    it('401 받은 토큰은 다시 보내지 않는다 — 같은 토큰이면 요청 없이 expired', async () => {
      const spy = stub401();
      const source = new ClaudeSource();
      expect((await source.fetch()).state).toBe('expired');
      expect((await source.fetch()).state).toBe('expired');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('재로그인으로 토큰이 바뀌면 바로 요청한다', async () => {
      const spy = stub401();
      const source = new ClaudeSource();
      await source.fetch();
      process.env['CLAUDE_CODE_OAUTH_TOKEN'] = 'sk-ant-oat01-renewed-token-value';
      await source.fetch();
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('거부 기억은 15분 뒤 풀린다 — 같은 토큰도 다시 보낸다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const spy = stub401();
      const source = new ClaudeSource();
      await source.fetch();
      vi.setSystemTime(Date.now() + 15 * 60_000);
      await source.fetch();
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
