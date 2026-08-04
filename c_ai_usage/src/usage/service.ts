import streamDeck from '@elgato/streamdeck';

import {
  EMPTY_SLOTS,
  type LimitsSource,
  type SourceState,
  type UsageSlots,
  type UsageViewModel,
} from './types';

export type UsageServiceOptions = {
  /** 성공 시 다음 폴링까지의 간격. */
  intervalMs: number;
  /** 이 나이를 넘은 last-good 은 더 이상 보여주지 않고 실패 상태를 그대로 드러낸다. */
  staleLimitMs: number;
};

/** 백오프 상한. 이보다 길게 기다리지는 않는다. */
const MAX_BACKOFF_MS = 30 * 60 * 1000;
/** 연속 실패 이 횟수부터 서킷을 열고 고정 쿨다운으로 넘어간다. */
const CIRCUIT_THRESHOLD = 4;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000;
/** 첫 fetch 를 흩뜨려 프로바이더 여럿이 동시에 쏘지 않게 한다. */
const MAX_FIRST_JITTER_MS = 5000;

/**
 * 마지막 성공값을 계속 보여줄 수 있는 실패 — 인증·권한은 정상이고 일시적인 것뿐이다.
 * 나머지 실패는 사용자 조치가 필요하므로 last-good 으로 덮지 않고 그대로 드러낸다.
 */
const SOFT_FAILURES: ReadonlySet<SourceState> = new Set<SourceState>(['throttled', 'network']);

export type UsageService = {
  /** 구독하고 즉시 현재 값을 1회 받는다. 반환된 함수를 disappear 에서 호출한다. */
  subscribe(listener: (vm: UsageViewModel) => void): () => void;
};

/**
 * 프로바이더당 하나. 네트워크 타이머와 last-good 캐시를 **여기서만** 소유하고,
 * 액션 인스턴스는 구독만 한다.
 *
 * media_controller 의 인스턴스별 `setInterval` 관용구를 여기서 쓰면 안 된다 — 거기선 폴링이
 * 로컬 캐시 읽기라 공짜지만 여기서는 매번 레이트리밋된 HTTPS 요청이고, 다이얼 2개를 올리는
 * 순간 요청률이 2배가 된다.
 *
 * 이 구현이 지키는 네 규칙(ai-limits-plan.md §5 — §0 사고가 넷 다 어겼다):
 * 1. 동시 요청 1개  2. 실패 시 지수 백오프(간격이 절대 짧아지지 않는다)
 * 3. 연속 실패 → 서킷 오픈  4. 인스턴스 수가 요청률에 영향 없음
 */
export function createUsageService(source: LimitsSource, opts: UsageServiceOptions): UsageService {
  const listeners = new Set<(vm: UsageViewModel) => void>();
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;
  let failures = 0;
  let lastGood: { slots: UsageSlots; fetchedAtMs: number } | null = null;
  let vm: UsageViewModel = {
    provider: source.provider,
    slots: EMPTY_SLOTS,
    state: 'loading',
    fetchedAtMs: null,
  };

  function emit(next: UsageViewModel): void {
    // 상태가 바뀔 때만 기록한다 — 매 폴링마다 찍으면 성공 경로가 로그를 가득 채운다.
    // 수치는 PII 가 아니라 남겨도 되지만, 응답 본문은 어떤 경우에도 기록하지 않는다(§4.2).
    if (next.state !== vm.state) {
      streamDeck.logger.info(
        `${source.provider} usage: ${vm.state} → ${next.state}${summarize(next)}`,
      );
    }
    vm = next;
    for (const listener of listeners) {
      listener(vm);
    }
  }

  function schedule(delayMs: number): void {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    // 구독자가 없으면 재무장하지 않는다. 무조건 재무장이 §0 hot loop 의 핵심이었다.
    if (listeners.size === 0) {
      timer = undefined;
      return;
    }
    timer = setTimeout(() => void poll(), delayMs);
  }

  /** 실패 시 대기 시간. 항상 `intervalMs` 이상이다 — 실패가 요청 빈도를 올리는 경로를 없앤다. */
  function backoffMs(): number {
    if (failures >= CIRCUIT_THRESHOLD) {
      return Math.max(CIRCUIT_COOLDOWN_MS, opts.intervalMs);
    }
    return Math.min(opts.intervalMs * 2 ** failures, MAX_BACKOFF_MS);
  }

  async function poll(): Promise<void> {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      const result = await source.fetch();
      const now = Date.now();

      if (result.state === 'ok') {
        failures = 0;
        lastGood = { slots: result.slots, fetchedAtMs: now };
        emit({ provider: source.provider, slots: result.slots, state: 'ok', fetchedAtMs: now });
        schedule(opts.intervalMs);
        return;
      }

      const canShowLastGood =
        SOFT_FAILURES.has(result.state) &&
        lastGood !== null &&
        now - lastGood.fetchedAtMs <= opts.staleLimitMs;
      emit(
        canShowLastGood && lastGood !== null
          ? {
              provider: source.provider,
              slots: lastGood.slots,
              state: 'stale',
              fetchedAtMs: lastGood.fetchedAtMs,
            }
          : {
              provider: source.provider,
              slots: EMPTY_SLOTS,
              state: result.state,
              fetchedAtMs: null,
            },
      );
      failures += 1;
      streamDeck.logger.warn(`${source.provider} usage: ${result.state} (연속 ${failures}회)`);
      schedule(backoffMs());
    } catch (err) {
      // 어댑터는 실패를 state 로 되돌리게 되어 있다. 여기 오는 건 예상 못 한 버그다.
      failures += 1;
      streamDeck.logger.error(`${source.provider} usage 어댑터 예외`, err);
      emit({ provider: source.provider, slots: EMPTY_SLOTS, state: 'network', fetchedAtMs: null });
      schedule(backoffMs());
    } finally {
      inFlight = false;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(vm);
      if (listeners.size === 1) {
        schedule(Math.floor(Math.random() * MAX_FIRST_JITTER_MS));
      }
      return () => {
        listeners.delete(listener);
        // 보이는 인스턴스가 없으면 폴링을 멈춘다.
        if (listeners.size === 0 && timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
    },
  };
}

/** 로그용 한 줄 요약. 창이 비면 `—` 로 표시해 0% 와 구분한다. */
function summarize(vm: UsageViewModel): string {
  if (vm.state !== 'ok' && vm.state !== 'stale') {
    return '';
  }
  const cell = (w: UsageViewModel['slots']['week']): string =>
    w === null || w.utilization === null ? '—' : `${Math.floor(w.utilization)}%`;
  return ` (5H ${cell(vm.slots.fiveHour)} / WK ${cell(vm.slots.week)})`;
}
