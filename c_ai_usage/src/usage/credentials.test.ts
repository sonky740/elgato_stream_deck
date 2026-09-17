import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isExpired, readClaudeCredential, readCodexCredential } from './credentials';

let dir: string;
const realPlatform = process.platform;

const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value, configurable: true });
};

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'c-ai-usage-cred-'));
});

afterEach(() => {
  setPlatform(realPlatform);
  delete process.env['CLAUDE_CONFIG_DIR'];
  delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  delete process.env['CODEX_HOME'];
});

describe('readClaudeCredential', () => {
  it('env 오버라이드가 최우선이다', async () => {
    process.env['CLAUDE_CODE_OAUTH_TOKEN'] = 'sk-ant-oat01-from-env';
    const cred = await readClaudeCredential();
    expect(cred?.accessToken).toBe('sk-ant-oat01-from-env');
    expect(cred?.expiresAtMs).toBeNull();
  });

  it('darwin 이 아니면 파일에서 읽는다 — Windows·Linux 경로(Phase 5)', async () => {
    setPlatform('win32');
    process.env['CLAUDE_CONFIG_DIR'] = dir;
    writeFileSync(
      path.join(dir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: { accessToken: 'sk-ant-oat01-file', expiresAt: 1786256175000 },
        mcpOAuth: { 'some-server': { clientSecret: 'MUST-NOT-LEAK' } },
      }),
    );
    const cred = await readClaudeCredential();
    expect(cred?.accessToken).toBe('sk-ant-oat01-file');
    expect(cred?.expiresAtMs).toBe(1786256175000);
    // blob 에 동거하는 MCP 시크릿이 반환 객체로 새지 않는다.
    expect(JSON.stringify(cred)).not.toContain('MUST-NOT-LEAK');
  });

  it('파일이 없으면 null', async () => {
    setPlatform('win32');
    process.env['CLAUDE_CONFIG_DIR'] = dir;
    expect(await readClaudeCredential()).toBeNull();
  });

  it('claudeAiOauth 가 없으면 null — 다른 필드로 대체 추측하지 않는다', async () => {
    setPlatform('win32');
    process.env['CLAUDE_CONFIG_DIR'] = dir;
    writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ mcpOAuth: {} }));
    expect(await readClaudeCredential()).toBeNull();
  });

  it('expiresAt 이 숫자가 아니면 null 로 둔다 — 만료 미지를 만료로 보지 않는다', async () => {
    setPlatform('win32');
    process.env['CLAUDE_CONFIG_DIR'] = dir;
    writeFileSync(
      path.join(dir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: 'soon' } }),
    );
    expect((await readClaudeCredential())?.expiresAtMs).toBeNull();
  });
});

describe('readCodexCredential', () => {
  it('CODEX_HOME 을 존중한다 — Windows 도 같은 파일 구조다(Phase 5)', async () => {
    process.env['CODEX_HOME'] = dir;
    const payload = Buffer.from(JSON.stringify({ exp: 1786256175 }), 'utf8').toString('base64url');
    writeFileSync(
      path.join(dir, 'auth.json'),
      JSON.stringify({
        tokens: { access_token: `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`, account_id: 'acct-9' },
      }),
    );
    const cred = await readCodexCredential();
    expect(cred?.accountId).toBe('acct-9');
    expect(cred?.expiresAtMs).toBe(1786256175 * 1000);
  });

  it('JWT 가 깨져 있으면 만료를 null 로 둔다 — 파싱 실패를 만료로 보지 않는다', async () => {
    process.env['CODEX_HOME'] = dir;
    writeFileSync(
      path.join(dir, 'auth.json'),
      JSON.stringify({ tokens: { access_token: 'not-a-jwt' } }),
    );
    const cred = await readCodexCredential();
    expect(cred?.accessToken).toBe('not-a-jwt');
    expect(cred?.expiresAtMs).toBeNull();
  });

  it('파일이 없으면 null', async () => {
    process.env['CODEX_HOME'] = dir;
    expect(await readCodexCredential()).toBeNull();
  });
});

describe('isExpired', () => {
  it('만료 시각을 모르면 만료로 보지 않는다', () => {
    expect(isExpired(null, Date.now())).toBe(false);
  });

  it('과거면 만료', () => {
    expect(isExpired(1000, 2000)).toBe(true);
    expect(isExpired(2000, 2000)).toBe(true);
    expect(isExpired(3000, 2000)).toBe(false);
  });
});
