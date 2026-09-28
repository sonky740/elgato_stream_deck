import { createHash } from 'node:crypto';

import streamDeck from '@elgato/streamdeck';

import type { Provider, SourceState } from './types';

/**
 * 거부된 토큰을 다시 보내지 않는 시간. 서비스의 서킷 쿨다운과 같은 값이라 거부 토큰의 요청률이
 * 서킷과 같다. TTL 을 두는 이유는 일시적 401 이 토큰이 바뀔 때까지(Codex 는 며칠) 굳지 않게 하기 위해서다.
 */
const TTL_MS = 15 * 60 * 1000;

/** 해결책이 새 자격증명뿐인 실패. `blocked` 는 403 이어도 Cloudflare 게이트라 토큰 탓이 아니다. */
export const CREDENTIAL_REJECTIONS: ReadonlySet<SourceState> = new Set<SourceState>([
  'expired',
  'revoked',
  'forbidden',
]);

const fingerprintOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * 서버가 거부한 토큰을 지문으로 기억해 같은 토큰으로는 다시 요청하지 않는다 — 백오프를 토큰 단위로
 * 거는 셈이라, 재로그인으로 토큰이 바뀌면 대기 없이 바로 요청이 나간다. 토큰 원문은 보관하지 않는다.
 */
export class RejectedToken {
  readonly #provider: Provider;
  #fingerprint: string | null = null;
  #state: SourceState = 'expired';
  #untilMs = 0;

  constructor(provider: Provider) {
    this.#provider = provider;
  }

  /** 이 토큰이 TTL 안에 거부됐으면 그때의 상태, 아니면 `null`. */
  recall(token: string, nowMs: number): SourceState | null {
    return nowMs < this.#untilMs && this.#fingerprint === fingerprintOf(token) ? this.#state : null;
  }

  /** 자격증명 거부일 때만 기억한다. 그 외 실패는 무시한다. */
  note(token: string, state: SourceState, nowMs: number): void {
    if (!CREDENTIAL_REJECTIONS.has(state)) {
      return;
    }
    this.#fingerprint = fingerprintOf(token);
    this.#state = state;
    this.#untilMs = nowMs + TTL_MS;
    streamDeck.logger.info(
      `${this.#provider} usage: server rejected the token (${state}), not resending it for ${TTL_MS / 60_000} min`,
    );
  }
}
