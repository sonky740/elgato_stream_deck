import type { Basis, ChartType, Thresholds } from './render/gauge';

/**
 * 인스턴스별 설정. 다이얼 2개에 서로 다른 차트를 띄울 수 있어야 하므로 전역이 아니다.
 *
 * ⚠ 액션 설정은 **평문으로 저장되고 Stream Deck 프로필 export 에 포함된다.** 토큰류를 절대
 * 여기 두지 않는다 — 프로필을 공유하거나 백업하면 같이 나간다(SPEC "설정 스코프").
 */
export type GaugeSettings = {
  chart?: ChartType;
  basis?: Basis;
  /** 사용량 기준 임계(%). 전역이 아닌 이유는 {@link GlobalSettings} 참고. */
  warnAt?: number;
  critAt?: number;
};

/**
 * 전역 설정. **프로바이더 공유 자원만** 둔다 — 폴링 간격은 인스턴스마다 다르면 요청률이
 * 인스턴스 수만큼 곱해지기 때문이다. 임계값은 공유 자원이 아니라 판독 정책이라 인스턴스별이다.
 */
export type GlobalSettings = {
  pollIntervalSec?: number;
};

/** v1 동작과 같은 값이다 — PI 가 붙어도 기존 사용자의 화면이 바뀌지 않아야 한다. */
export const DEFAULT_CHART: ChartType = 'donut';
export const DEFAULT_BASIS: Basis = 'used';
export const DEFAULT_WARN_AT = 80;
export const DEFAULT_CRIT_AT = 95;
export const DEFAULT_THRESHOLDS: Thresholds = {
  warnAt: DEFAULT_WARN_AT,
  critAt: DEFAULT_CRIT_AT,
};

/**
 * 임계값의 유효 범위. 드롭다운은 이 범위 밖을 고를 수 없지만 **두 드롭다운이 서로를 모르므로
 * 뒤집힌 조합(warn 90 · crit 85)은 UI 로도 만들 수 있다** — 그래서 순서 불변식은 clamp 가
 * 아니라 {@link resolveThresholds} 가 세운다. 범위 clamp 는 평문 JSON 편집·프로필 import 용이다.
 *
 * 목록을 여기 두지 않는 이유: 드롭다운 항목은 PI HTML 만의 것이고, 코드가 목록을 알면
 * 항목을 추가할 때 고칠 곳이 두 군데가 된다.
 */
const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 100;

/**
 * 폴링 간격 기본·한계. 하한 60s 는 게이트 2 실측(60s 간격 12회 429 0건)에 근거한다 —
 * 그보다 짧게 열어두면 사용자가 과거의 폭주 사고를 재현할 수 있다.
 */
export const DEFAULT_POLL_SEC = 300;
export const MIN_POLL_SEC = 60;
export const MAX_POLL_SEC = 3600;

/** 순환 순서이자 유효값 목록. 두 곳에 나눠 두면 차트를 추가할 때 한쪽을 빼먹는다. */
export const CHART_TYPES: readonly ChartType[] = ['donut', 'bar'];

export const resolveChart = (s: GaugeSettings | undefined): ChartType => {
  const chart = s?.chart;
  return chart !== undefined && CHART_TYPES.includes(chart) ? chart : DEFAULT_CHART;
};

/** `step` 칸 이동한 차트. 양끝에서 감싸므로 같은 방향으로 계속 돌려도 멈추지 않는다. */
export const nextChart = (current: ChartType, step: number): ChartType => {
  const len = CHART_TYPES.length;
  const i = CHART_TYPES.indexOf(current);
  return CHART_TYPES[(((i + step) % len) + len) % len] ?? DEFAULT_CHART;
};

/** 기준 전환. 2종뿐이라 순환이 아니라 뒤집기다. */
export const nextBasis = (current: Basis): Basis => {
  return current === 'used' ? 'remaining' : 'used';
};

export const resolveBasis = (s: GaugeSettings | undefined): Basis => {
  return s?.basis === 'remaining' || s?.basis === 'used' ? s.basis : DEFAULT_BASIS;
};

/**
 * 0 이하를 "없음"으로 보고 기본값으로 돌린다 — `Number('')` 와 `Number(null)` 이 **0** 이므로,
 * 이 가드가 없으면 빈 값이 "임계 0%"(= 전부 경고색)로 조용히 해석된다. 0 을 clamp 로만 막으면
 * 하한 1% 가 되어 증상이 같다.
 */
const clampThreshold = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(n), MIN_THRESHOLD), MAX_THRESHOLD);
};

/**
 * 임계값을 정규화한다. `risk()` 가 `warnAt <= critAt` 를 전제하므로 그 불변식을 여기서 세운다.
 *
 * 뒤집혀 들어오면(`warn=90` · `crit=80`) **critAt 을 authoritative 로 보고 warnAt 을 끌어내린다** —
 * "80%에 빨강" 을 지정했다면 그 위에 amber 가 들어갈 자리가 없다. 결과로 **amber 단계가 사라져
 * ok→red 로 바로 뛴다**(색만 바뀌는 게 아니라 경고 단계 하나를 잃는 것이다). 반대로 critAt 을
 * 끌어올리면 빨강이 늦게 와서, 한도 게이지에서 더 위험한 쪽으로 틀린다.
 *
 * `Number()` 로 받는 이유는 폴링 간격과 같다 — PI 가 문자열로 줄 수 있다.
 */
export const resolveThresholds = (s: GaugeSettings | undefined): Thresholds => {
  const critAt = clampThreshold(s?.critAt, DEFAULT_CRIT_AT);
  const warnAt = clampThreshold(s?.warnAt, DEFAULT_WARN_AT);
  return { warnAt: Math.min(warnAt, critAt), critAt };
};

/**
 * 전역 설정의 폴링 간격을 ms 로 정규화한다. PI 의 숫자 입력은 문자열로 올 수 있고 사용자가
 * 임의값을 넣을 수 있으므로 여기서 clamp 한다 — 렌더나 네트워크 계층이 아니라 경계에서.
 */
export const resolvePollMs = (s: GlobalSettings | undefined): number => {
  const raw = Number(s?.pollIntervalSec);
  if (!Number.isFinite(raw)) {
    return DEFAULT_POLL_SEC * 1000;
  }
  return Math.min(Math.max(Math.round(raw), MIN_POLL_SEC), MAX_POLL_SEC) * 1000;
};
