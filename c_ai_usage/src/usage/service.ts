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
 * 수동 새로고침의 최소 간격. 자동 폴링 하한(`MIN_POLL_SEC`)과 같은 값이고 창을 **마지막
 * 시도**(자동·수동 무관) 기준으로 재므로, 두 경로를 합쳐도 최악 요청률이 1/min 을 넘지 않는다 —
 * 게이트 2 가 실측한 하한과 같은 값이다. 대가로 버튼은 사용자가 고른 간격보다 빠를 수 있다.
 */
const MANUAL_MIN_GAP_MS = 60_000;

/**
 * 마지막 성공값을 계속 보여줄 수 있는 실패 — 인증·권한은 정상이고 일시적인 것뿐이다.
 * 나머지 실패는 사용자 조치가 필요하므로 last-good 으로 덮지 않고 그대로 드러낸다.
 */
const SOFT_FAILURES: ReadonlySet<SourceState> = new Set<SourceState>(['throttled', 'network']);

/**
 * 요청을 만들지 않는 실패 — 자격증명이 없거나 만료 선판정에 걸린 상태다. 백오프는 실패가
 * 요청 빈도를 올리는 경로를 막으려고 있으므로 요청 0건인 이 둘은 대상이 아니다. 먹이면 CLI
 * 재로그인으로 이미 고쳐진 뒤에도 화면이 최대 15분 굳고 수동 새로고침까지 같이 막힌다.
 */
const LOCAL_FAILURES: ReadonlySet<SourceState> = new Set<SourceState>(['no-credential', 'expired']);
/**
 * 로컬 실패를 백오프 없이 재확인하는 횟수 상한. 401 도 `expired` 로 오므로(`http.ts`) 상한이
 * 없으면 서버가 거부하는 토큰을 영원히 정상 간격으로 재시도한다.
 */
const LOCAL_RETRY_LIMIT = 3;

export type UsageService = {
  /** 구독하고 즉시 현재 값을 1회 받는다. 반환된 함수를 disappear 에서 호출한다. */
  subscribe(listener: (vm: UsageViewModel) => void): () => void;
  /** 전역 설정이 바뀌었을 때 폴링 간격을 갈아끼운다. */
  setIntervalMs(ms: number): void;
  /** PI 의 수동 새로고침. 쿨다운 안이거나 실패 백오프 중이면 아무것도 하지 않는다. */
  refresh(): void;
};

/** 로그용 한 줄 요약. 창이 비면 `—` 로 표시해 0% 와 구분한다. */
const summarize = (vm: UsageViewModel): string => {
  if (vm.state !== 'ok' && vm.state !== 'stale') {
    return '';
  }
  const cell = (w: UsageViewModel['slots']['week']): string =>
    w === null || w.utilization === null ? '—' : `${Math.floor(w.utilization)}%`;
  return ` (5H ${cell(vm.slots.fiveHour)} / WK ${cell(vm.slots.week)})`;
};

/**
 * 프로바이더당 하나. 네트워크 타이머와 last-good 캐시를 **여기서만** 소유하고 액션은 구독만
 * 한다 — media_controller 의 인스턴스별 `setInterval` 관용구를 복사하면 다이얼 2개에 요청률이
 * 2배가 된다(SPEC "실패가 요청 빈도를 올리는 경로가 없어야 한다" · "액션 인스턴스 수가 …").
 */
export const createUsageService = (
  source: LimitsSource,
  opts: UsageServiceOptions,
): UsageService => {
  let intervalMs = opts.intervalMs;
  const listeners = new Set<(vm: UsageViewModel) => void>();
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;
  let failures = 0;
  /** `LOCAL_FAILURES` 로 백오프 없이 재확인한 횟수. 성공하면 리셋된다. */
  let localRetries = 0;
  /** 마지막으로 **실제 요청을 시작한** 시각. 수동 새로고침 쿨다운의 기준이다. */
  let lastAttemptAtMs = 0;
  let lastGood: { slots: UsageSlots; fetchedAtMs: number } | null = null;
  let vm: UsageViewModel = {
    provider: source.provider,
    slots: EMPTY_SLOTS,
    state: 'loading',
    fetchedAtMs: null,
  };

  const emit = (next: UsageViewModel): void => {
    // 상태가 바뀔 때만 기록한다 — 매 폴링마다 찍으면 성공 경로가 로그를 가득 채운다.
    // 수치는 PII 가 아니라 남겨도 되지만, 응답 본문은 어떤 경우에도 기록하지 않는다.
    if (next.state !== vm.state) {
      streamDeck.logger.info(
        `${source.provider} usage: ${vm.state} → ${next.state}${summarize(next)}`,
      );
    }
    vm = next;
    for (const listener of listeners) {
      listener(vm);
    }
  };

  const schedule = (delayMs: number): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    // 구독자가 없으면 재무장하지 않는다. 무조건 재무장이 과거 hot loop 의 핵심이었다.
    if (listeners.size === 0) {
      timer = undefined;
      return;
    }
    timer = setTimeout(() => void poll(), delayMs);
  };

  /** 실패 시 대기 시간. 항상 `intervalMs` 이상이다 — 실패가 요청 빈도를 올리는 경로를 없앤다. */
  const backoffMs = (): number => {
    if (failures >= CIRCUIT_THRESHOLD) {
      return Math.max(CIRCUIT_COOLDOWN_MS, intervalMs);
    }
    return Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
  };

  const poll = async (): Promise<void> => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    // 버린 호출로는 갱신하지 않는다 — 갱신하면 계속 누르는 동안 쿨다운 창이 밀려 영구히
    // 막힌다(`#lastRotateMs` 가 회전 스로틀에서 피한 함정과 같은 구조다).
    lastAttemptAtMs = Date.now();
    try {
      const result = await source.fetch();
      const now = Date.now();

      if (result.state === 'ok') {
        failures = 0;
        localRetries = 0;
        lastGood = { slots: result.slots, fetchedAtMs: now };
        emit({ provider: source.provider, slots: result.slots, state: 'ok', fetchedAtMs: now });
        schedule(intervalMs);
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
      // 요청 0건 실패는 상한까지 정상 간격으로 다시 확인한다. 상태 변화가 없으면 emit 이
      // 로그를 남기지 않으므로, 기다리는 이유가 로그에서 사라지지 않게 여기서 한 줄 남긴다.
      if (LOCAL_FAILURES.has(result.state) && localRetries < LOCAL_RETRY_LIMIT) {
        localRetries += 1;
        streamDeck.logger.info(
          `${source.provider} usage: ${result.state} (local, recheck ${localRetries}/${LOCAL_RETRY_LIMIT})`,
        );
        schedule(intervalMs);
        return;
      }
      failures += 1;
      streamDeck.logger.warn(`${source.provider} usage: ${result.state} (${failures} in a row)`);
      schedule(backoffMs());
    } catch (err) {
      // 어댑터는 실패를 state 로 되돌리게 되어 있다. 여기 오는 건 예상 못 한 버그다.
      failures += 1;
      streamDeck.logger.error(`${source.provider} usage adapter threw`, err);
      emit({ provider: source.provider, slots: EMPTY_SLOTS, state: 'network', fetchedAtMs: null });
      schedule(backoffMs());
    } finally {
      inFlight = false;
    }
  };

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

    setIntervalMs(ms) {
      if (ms === intervalMs) {
        return;
      }
      intervalMs = ms;
      // 실패 중이면 다시 잡지 않는다 — 백오프·서킷 대기를 새 간격으로 갈아치우면 그 대기가
      // 짧아져 실패가 요청 빈도를 올리는 경로가 다시 열린다. 다음 성공 후부터 적용된다.
      if (failures === 0 && timer !== undefined) {
        schedule(intervalMs);
      }
    },

    refresh() {
      // 실패 중에는 창이 `backoffMs()` 다 — 그 값이 항상 `intervalMs` 이상이므로 버튼으로는
      // 백오프를 앞당길 수 없다. 로컬 실패는 `failures` 를 올리지 않아 창이 60s 로 남는다 —
      // 재로그인 직후 버튼이 동작해야 하는 경로이고, 그 fetch 도 상한 60s 를 넘지 않는다.
      const gapMs = failures === 0 ? MANUAL_MIN_GAP_MS : backoffMs();
      const waitedMs = Date.now() - lastAttemptAtMs;
      if (waitedMs < gapMs) {
        streamDeck.logger.info(
          `${source.provider} usage: manual refresh ignored (${Math.ceil((gapMs - waitedMs) / 1000)}s to go)`,
        );
        return;
      }
      // 구독자 0명 검사는 schedule() 이 갖는다 — 여기서 또 하면 같은 규칙이 두 곳에 생긴다.
      // 기존 타이머를 지우므로 다음 자동 폴링은 이 수동 fetch 시점부터 다시 센다.
      schedule(0);
    },
  };
};
