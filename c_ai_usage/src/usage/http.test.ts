import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getJson, USER_AGENT } from './http';

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'fixtures');

function respond(body: string, init: { status?: number; contentType?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJson', () => {
  it('자기 UA 를 보낸다 — CLI UA 를 흉내내지 않는다', async () => {
    const spy = vi.fn().mockResolvedValue(respond('{}'));
    vi.stubGlobal('fetch', spy);
    await getJson('https://example.test/u', { Authorization: 'Bearer x' });
    const headers = spy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).not.toContain('claude-cli');
  });

  it('200 JSON 을 파싱해 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('{"a":1}')));
    const res = await getJson('https://example.test/u', {});
    expect(res).toEqual({ kind: 'json', body: { a: 1 } });
  });

  it('Cloudflare 챌린지를 JSON 으로 파싱하지 않고 blocked 로 분류한다', async () => {
    const html = readFileSync(path.join(FIXTURES, 'codex-cloudflare-challenge.html'), 'utf8');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(html, { status: 403, contentType: 'text/html' })),
    );
    const res = await getJson('https://chatgpt.test/u', {});
    expect(res).toEqual({ kind: 'failed', state: 'blocked', status: 403 });
  });

  it('content-type 이 JSON 이라 주장해도 본문이 HTML 이면 blocked 다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond('  <html>nope</html>', { status: 403 })),
    );
    expect(await getJson('https://chatgpt.test/u', {})).toMatchObject({ state: 'blocked' });
  });

  it('상태코드를 각기 다른 state 로 매핑한다', async () => {
    const cases: [number, string, string][] = [
      [401, '{}', 'expired'],
      [403, '{"error":"forbidden"}', 'forbidden'],
      [403, '{"error":"OAuth token has been revoked"}', 'revoked'],
      [429, '{"error":{"type":"rate_limit_error"}}', 'throttled'],
      [500, '{}', 'network'],
    ];
    for (const [status, body, expected] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(body, { status })));
      expect(await getJson('https://example.test/u', {}), `${status}`).toMatchObject({
        state: expected,
      });
    }
  });

  it('200 이지만 JSON 이 깨졌으면 shape-changed 다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond('{not json')));
    expect(await getJson('https://example.test/u', {})).toMatchObject({ state: 'shape-changed' });
  });

  it('네트워크 예외를 throw 하지 않고 network 로 되돌린다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    expect(await getJson('https://example.test/u', {})).toEqual({
      kind: 'failed',
      state: 'network',
      status: null,
    });
  });
});
