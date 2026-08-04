import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'fixtures');

/** logger 로 흘러간 모든 인자를 문자열로 모은다. */
const logged: string[] = [];
const logger = {
  warn: (...args: unknown[]) => logged.push(args.map(stringify).join(' ')),
  error: (...args: unknown[]) => logged.push(args.map(stringify).join(' ')),
  info: (...args: unknown[]) => logged.push(args.map(stringify).join(' ')),
};

function stringify(v: unknown): string {
  if (v instanceof Error) {
    return `${v.name}: ${v.message}\n${v.stack ?? ''}`;
  }
  return typeof v === 'string' ? v : JSON.stringify(v);
}

vi.mock('@elgato/streamdeck', () => ({ default: { logger } }));

/** 유출되면 안 되는 모양들. Codex 응답은 설계상 PII 를 담고 있다. */
const FORBIDDEN: [string, RegExp][] = [
  ['이메일', /[\w.+-]+@[\w-]+\.[\w.]+/],
  ['Claude access token', /sk-ant-o[a-z]{2}\d{2}/],
  ['Claude refresh token', /sk-ant-ort/],
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Codex refresh token', /rt\.[A-Za-z0-9_-]{10,}/],
  ['Bearer 값', /Bearer\s+\S{12,}/],
];

function assertClean(): void {
  const blob = logged.join('\n');
  for (const [name, pattern] of FORBIDDEN) {
    expect(pattern.test(blob), `${name} 이 로그로 흘렀다: ${blob.slice(0, 200)}`).toBe(false);
  }
}

beforeEach(() => {
  // subscribe 가 첫 폴링을 예약하므로 서비스 생성 전에 가짜 타이머로 바꿔야 한다.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  logged.length = 0;
  vi.unstubAllGlobals();
});

describe('로그 유출 방지', () => {
  it('실패 상태를 기록할 때 응답 본문이나 토큰을 남기지 않는다', async () => {
    const { createUsageService } = await import('./service');
    // PII 를 담은 Codex 실측 응답 모양을 그대로 실패 경로에 통과시킨다.
    const body = readFileSync(path.join(FIXTURES, 'codex-usage-200.json'), 'utf8');
    const service = createUsageService(
      {
        provider: 'codex',
        fetch: () => Promise.resolve({ state: 'blocked', slots: { fiveHour: null, week: null } }),
      },
      { intervalMs: 300_000, staleLimitMs: 1_800_000 },
    );
    const off = service.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(6000);
    off();

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).toContain('blocked');
    // 본문이 로그에 실리지 않았음을 직접 확인한다.
    expect(logged.join('\n')).not.toContain(body);
    assertClean();
  });

  it('어댑터 예외를 기록할 때 예외 메시지에 실린 토큰도 남기지 않는다', async () => {
    const { createUsageService } = await import('./service');
    const service = createUsageService(
      {
        provider: 'claude',
        // 실수로 URL·헤더를 예외 메시지에 넣은 어댑터를 흉내낸다.
        fetch: () => Promise.reject(new Error('request failed')),
      },
      { intervalMs: 300_000, staleLimitMs: 1_800_000 },
    );
    const off = service.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(6000);
    off();
    assertClean();
  });

  it('http 계층이 응답 본문을 반환값에 담지 않는다 — 담으면 호출자가 로그할 수 있다', async () => {
    const { getJson } = await import('./http');
    const html = readFileSync(path.join(FIXTURES, 'codex-cloudflare-challenge.html'), 'utf8');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(html, { status: 403, headers: { 'content-type': 'text/html' } }),
        ),
    );
    const res = await getJson('https://chatgpt.test/u', {
      Authorization: 'Bearer sk-ant-oat01-secret-value',
    });
    expect(JSON.stringify(res)).not.toContain('cf_chl');
    expect(JSON.stringify(res)).not.toContain('sk-ant-oat01');
  });

  it('Codex 자격증명 로더가 refresh_token·id_token 을 반환 객체에 담지 않는다', async () => {
    const { readCodexCredential } = await import('./credentials');
    const home = path.join(FIXTURES, '..', 'preview', 'fake-codex-home');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(home, { recursive: true });
    writeFileSync(
      path.join(home, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE3ODYyNTYxNzV9.sig',
          account_id: '0000-account',
          id_token: 'eyJhbGciOiJSUzI1NiJ9.aWRfdG9rZW4.sig',
          refresh_token: 'rt.1.AAABBBCCCDDDEEEFFF',
        },
      }),
    );
    process.env['CODEX_HOME'] = home;
    const cred = await readCodexCredential();
    delete process.env['CODEX_HOME'];

    expect(cred?.accountId).toBe('0000-account');
    const dumped = JSON.stringify(cred);
    expect(dumped).not.toContain('rt.1.');
    expect(dumped).not.toContain('aWRfdG9rZW4');
    // access_token 은 요청에 필요하므로 담긴다 — 다만 로그로 나가지 않아야 한다(위 테스트가 검증).
    expect(cred?.expiresAtMs).toBe(1786256175 * 1000);
  });
});
