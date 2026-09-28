import { describe, expect, it, vi } from 'vitest';

import { RejectedToken } from './rejected-token';
import type { SourceState } from './types';

vi.mock('@elgato/streamdeck', () => ({
  default: { logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));

/** 거부 토큰을 다시 보내지 않는 시간(rejected-token.ts 와 같은 값). */
const TTL = 15 * 60_000;
const NOW = 1_000_000;

describe('RejectedToken', () => {
  it.each<SourceState>(['expired', 'revoked', 'forbidden'])(
    '서버가 거부한 토큰(%s)은 같은 토큰이면 요청 없이 그때의 상태를 되풀이한다',
    (state) => {
      const rejected = new RejectedToken('codex');
      rejected.note('token-a', state, NOW);
      expect(rejected.recall('token-a', NOW + 1)).toBe(state);
    },
  );

  it('토큰이 바뀌면 기억이 맞지 않는다 — 재로그인하면 바로 요청이 나가야 한다', () => {
    const rejected = new RejectedToken('codex');
    rejected.note('token-a', 'expired', NOW);
    expect(rejected.recall('token-b', NOW + 1)).toBeNull();
  });

  it('TTL 이 지나면 같은 토큰도 다시 보낸다 — 일시적 401 이 토큰 교체 전까지 굳지 않게', () => {
    const rejected = new RejectedToken('codex');
    rejected.note('token-a', 'expired', NOW);
    expect(rejected.recall('token-a', NOW + TTL - 1)).toBe('expired');
    expect(rejected.recall('token-a', NOW + TTL)).toBeNull();
  });

  it.each<SourceState>(['blocked', 'throttled', 'network', 'shape-changed', 'unentitled'])(
    '토큰 탓이 아닌 실패(%s)는 기억하지 않는다 — Cloudflare 403 도 blocked 로 온다',
    (state) => {
      const rejected = new RejectedToken('codex');
      rejected.note('token-a', state, NOW);
      expect(rejected.recall('token-a', NOW + 1)).toBeNull();
    },
  );
});
