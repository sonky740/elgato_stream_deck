import type { FetchResult, LimitsSource, Provider, SourceState, UsageWindow } from './types';

/**
 * 네트워크 없이 실기기에서 모든 상태를 눌러보기 위한 소스.
 *
 * 실패 상태 11종은 실제 서버를 그 상태로 만들 수 없어 라이브로는 확인이 불가능하다 —
 * 429 를 재현하려면 할당량을 태워야 하고, 토큰 폐기는 되돌릴 수 없다. 그래서 온디바이스
 * 확인용 경로를 따로 둔다. 게이트 1(SVG 래스터라이저 확인)도 이걸로 돌린다.
 *
 *   C_AI_USAGE_FAKE=cycle    폴링마다 다음 상태로 (전 상태 순회)
 *   C_AI_USAGE_FAKE=<state>  그 상태로 고정 (예: throttled, no-credential, unentitled)
 *   C_AI_USAGE_FAKE=one      정상이지만 5HR 슬롯이 빈 상태 (현재 Codex 모양)
 *   C_AI_USAGE_FAKE=unknown  정상이지만 utilization 이 null (0% 와 구분되는지 확인)
 */
export function fakeSourceFromEnv(provider: Provider): LimitsSource | null {
  const mode = process.env['C_AI_USAGE_FAKE'];
  return mode === undefined || mode === '' ? null : new FakeSource(provider, mode);
}

const CYCLE: SourceState[] = [
  'ok',
  'stale',
  'throttled',
  'network',
  'no-credential',
  'expired',
  'revoked',
  'forbidden',
  'unentitled',
  'blocked',
  'shape-changed',
];

function win(label: string, durationSec: number, utilization: number | null): UsageWindow {
  return { label, durationSec, utilization, resetsAtMs: null };
}

class FakeSource implements LimitsSource {
  readonly provider: Provider;
  readonly #mode: string;
  #tick = 0;

  constructor(provider: Provider, mode: string) {
    this.provider = provider;
    this.#mode = mode;
  }

  fetch(): Promise<FetchResult> {
    if (this.#mode === 'one') {
      return Promise.resolve({
        state: 'ok',
        slots: { fiveHour: null, week: win('WK', 604800, 18) },
      });
    }
    if (this.#mode === 'unknown') {
      return Promise.resolve({
        state: 'ok',
        slots: { fiveHour: win('5H', 18000, null), week: win('WK', 604800, 26) },
      });
    }
    // 'stale' 은 서비스가 만들어내는 상태라 어댑터가 직접 반환할 수 없다 — soft 실패로 흉내낸다.
    const state =
      this.#mode === 'cycle'
        ? (CYCLE[this.#tick++ % CYCLE.length] ?? 'ok')
        : (this.#mode as SourceState);
    if (state === 'ok' || state === 'stale') {
      const base = this.#tick * 7;
      return Promise.resolve({
        state: 'ok',
        slots: {
          fiveHour: win('5H', 18000, base % 101),
          week: win('WK', 604800, (base * 2) % 101),
        },
      });
    }
    return Promise.resolve({ state, slots: { fiveHour: null, week: null } });
  }
}
