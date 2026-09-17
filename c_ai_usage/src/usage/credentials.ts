import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 자격증명 읽기에 허용하는 시간. 렌더를 자격증명 조회로 오래 붙잡아두지 않는다. */
const READ_TIMEOUT_MS = 5000;

export type ClaudeCredential = {
  accessToken: string;
  /** epoch ms. 만료 선판정에 쓴다 — 확실히 실패할 요청을 네트워크에 내보내지 않기 위해. */
  expiresAtMs: number | null;
};

export type CodexCredential = {
  accessToken: string;
  accountId: string | null;
  /** access_token JWT 의 `exp`(초)를 ms 로 변환한 값. auth.json 에는 만료 필드가 없다. */
  expiresAtMs: number | null;
};

/** 만료 선판정. `null`(만료 시각 미지)은 만료로 보지 않는다. */
export const isExpired = (expiresAtMs: number | null, nowMs: number): boolean => {
  return expiresAtMs !== null && expiresAtMs <= nowMs;
};

const readKeychain = (): Promise<unknown> => {
  const account = os.userInfo().username;
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-a', account, '-w'],
      { timeout: READ_TIMEOUT_MS },
      (err, stdout) => {
        if (err !== null || stdout === '') {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      },
    );
  });
};

const readJsonFile = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
};

const readClaudeCredentialFile = (): Promise<unknown> => {
  const dir = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude');
  return readJsonFile(path.join(dir, '.credentials.json'));
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

/**
 * Claude Code 의 OAuth access token 을 읽는다. macOS 는 키체인, 그 외는 파일.
 * 읽기만 한다 — refresh token 이 1회용으로 회전해 여기서 갱신하면 CLI 가 로그아웃된다
 * (SPEC "토큰 refresh 를 절대 하지 않는다"). 만료는 CLI 가 갱신하면 다음 폴링에 풀린다.
 */
export const readClaudeCredential = async (): Promise<ClaudeCredential | null> => {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (envToken !== undefined && envToken !== '') {
    return { accessToken: envToken, expiresAtMs: null };
  }
  const raw =
    process.platform === 'darwin' ? await readKeychain() : await readClaudeCredentialFile();
  if (raw === null) {
    return null;
  }
  // blob 에는 `claudeAiOauth` 외에 MCP 서버별 clientId/clientSecret 이 함께 들어 있다.
  // 이 한 필드만 꺼내고 나머지는 절대 건드리지 않는다.
  const oauth = asRecord(asRecord(raw)?.['claudeAiOauth']);
  if (oauth === null) {
    return null;
  }
  const accessToken = oauth['accessToken'];
  if (typeof accessToken !== 'string' || accessToken === '') {
    return null;
  }
  const expiresAt = oauth['expiresAt'];
  return {
    accessToken,
    expiresAtMs: typeof expiresAt === 'number' ? expiresAt : null,
  };
};

/** JWT payload 의 `exp`(초) → epoch ms. 서명은 검증하지 않는다 — 만료 판정에만 쓴다. */
const jwtExpiryMs = (jwt: string): number | null => {
  const payload = jwt.split('.')[1];
  if (payload === undefined) {
    return null;
  }
  try {
    const json: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = asRecord(json)?.['exp'];
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};

/** Codex CLI 의 ChatGPT access token. Claude 와 달리 만료를 JWT 에서 직접 파내야 한다. */
export const readCodexCredential = async (): Promise<CodexCredential | null> => {
  const home = process.env['CODEX_HOME'] ?? path.join(os.homedir(), '.codex');
  const parsed = await readJsonFile(path.join(home, 'auth.json'));
  const tokens = asRecord(asRecord(parsed)?.['tokens']);
  if (tokens === null) {
    return null;
  }
  const accessToken = tokens['access_token'];
  if (typeof accessToken !== 'string' || accessToken === '') {
    return null;
  }
  const accountId = tokens['account_id'];
  return {
    accessToken,
    accountId: typeof accountId === 'string' ? accountId : null,
    expiresAtMs: jwtExpiryMs(accessToken),
  };
};
