export type Provider = 'claude' | 'codex';

/**
 * 사용량 창 하나. 두 프로바이더의 서로 다른 단위 관용구를 여기로 정규화한다
 * (Claude: float 0..100 + ISO 문자열 / Codex: int 0..100 + epoch 초).
 */
export type UsageWindow = {
  /** 표시 라벨. 응답의 슬롯 위치가 아니라 창 길이에서 파생한다 — 위치로 붙이면 조용히 틀린다. */
  label: string;
  durationSec: number;
  /** 0..100. `null` 은 "모름"이며 0% 로 렌더해선 안 된다. */
  utilization: number | null;
  resetsAtMs: number | null;
};

/**
 * 소스가 지금 어떤 상태인지. 값마다 서로 구분되는 렌더를 갖는다 —
 * 구분이 없으면 사용자가 "여유 있음"과 "플러그인 고장"을 분간할 수 없다.
 */
export type SourceState =
  | 'loading'
  | 'ok'
  /** 마지막 성공값을 나이와 함께 보여주는 중. 429·네트워크 실패의 정상 경로다. */
  | 'stale'
  | 'no-credential'
  | 'expired'
  | 'revoked'
  /** 403 — 토큰에 `user:profile` scope 가 없다(구형 setup-token). */
  | 'forbidden'
  /** 200 이지만 본문이 비어 있다. 사용량 0이 아니라 미권한이다. */
  | 'unentitled'
  | 'throttled'
  /** Cloudflare 챌린지(HTML 본문). JSON 으로 파싱하면 안 된다. */
  | 'blocked'
  | 'network'
  | 'shape-changed';

/** 슬롯 2개 고정. 채울 데이터가 없으면 `null` → 공란 렌더. */
export type UsageSlots = {
  fiveHour: UsageWindow | null;
  week: UsageWindow | null;
};

export type UsageViewModel = {
  provider: Provider;
  slots: UsageSlots;
  state: SourceState;
  /** 마지막 성공 fetch 시각. staleness 표시에 쓴다. 성공한 적 없으면 `null`. */
  fetchedAtMs: number | null;
};

/** 소스 어댑터가 반환하는 1회 조회 결과. */
export type FetchResult = {
  state: SourceState;
  /** `state === 'ok'` 일 때만 의미가 있다. */
  slots: UsageSlots;
};

/**
 * 프로바이더별 조회 어댑터. 단위 변환은 전부 이 뒤에서 끝난다.
 *
 * 실패를 throw 하지 않고 `state` 로 표현한다 — 429 는 에러가 아니라 "마지막 성공값을
 * 나이와 함께 보여주는" 정상 경로이므로, 호출자가 예외 처리로 그것을 판단하게 하면 안 된다.
 */
export interface LimitsSource {
  readonly provider: Provider;
  fetch(): Promise<FetchResult>;
}

export const EMPTY_SLOTS: UsageSlots = { fiveHour: null, week: null };

/** 5시간 버킷 상한. 이 값 이하 길이의 창이 5HR 슬롯에 들어간다. */
const FIVE_HOUR_MAX_SEC = 24 * 60 * 60;
/** 주간 버킷 하한. */
const WEEK_MIN_SEC = 3 * 24 * 60 * 60;

const mostBinding = (windows: readonly UsageWindow[]): UsageWindow | null => {
  let best: UsageWindow | null = null;
  for (const w of windows) {
    if (best === null || (w.utilization ?? -1) > (best.utilization ?? -1)) {
      best = w;
    }
  }
  return best;
};

/**
 * 창 목록을 고정 슬롯 2개에 배정한다. 정확히 300분/10080분을 매칭하지 않고 범위로 잡는 이유는
 * 벤더가 창 길이를 조정해도 라벨이 깨지지 않게 하기 위해서다.
 *
 * 버킷 안에 여러 창이 있으면 **utilization 이 가장 높은 것**을 고른다 — `seven_day` 26% 와
 * `seven_day_opus` 80% 가 함께 올 때 사용자의 실제 제약은 후자다.
 */
export const assignSlots = (windows: readonly UsageWindow[]): UsageSlots => {
  return {
    fiveHour: mostBinding(
      windows.filter((w) => w.durationSec > 0 && w.durationSec <= FIVE_HOUR_MAX_SEC),
    ),
    week: mostBinding(windows.filter((w) => w.durationSec >= WEEK_MIN_SEC)),
  };
};
