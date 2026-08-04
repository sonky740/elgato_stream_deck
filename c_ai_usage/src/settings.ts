import type { Basis, ChartType } from './render/gauge';

/**
 * 인스턴스별 설정. 다이얼 2개에 서로 다른 차트를 띄울 수 있어야 하므로 전역이 아니다.
 *
 * ⚠ 액션 설정은 **평문으로 저장되고 Stream Deck 프로필 export 에 포함된다.** 토큰류를 절대
 * 여기 두지 않는다 — 프로필을 공유하거나 백업하면 같이 나간다(ai-limits-plan.md §9).
 */
export type GaugeSettings = {
  chart?: ChartType;
  basis?: Basis;
};

/** 전역 설정. 프로바이더 공유 자원(폴링 간격)만 둔다. */
export type GlobalSettings = {
  pollIntervalSec?: number;
};

/** v1 동작과 같은 값이다 — PI 가 붙어도 기존 사용자의 화면이 바뀌지 않아야 한다. */
export const DEFAULT_CHART: ChartType = 'donut';
export const DEFAULT_BASIS: Basis = 'used';

/**
 * 폴링 간격 기본·한계. 하한 60s 는 게이트 2 실측(60s 간격 12회 429 0건)에 근거한다 —
 * 그보다 짧게 열어두면 사용자가 §0 사고를 재현할 수 있다.
 */
export const DEFAULT_POLL_SEC = 300;
export const MIN_POLL_SEC = 60;
export const MAX_POLL_SEC = 3600;

/** 순환 순서이자 유효값 목록. 두 곳에 나눠 두면 차트를 추가할 때 한쪽을 빼먹는다. */
export const CHART_TYPES: readonly ChartType[] = ['donut', 'bar'];

export function resolveChart(s: GaugeSettings | undefined): ChartType {
  const chart = s?.chart;
  return chart !== undefined && CHART_TYPES.includes(chart) ? chart : DEFAULT_CHART;
}

/** `step` 칸 이동한 차트. 양끝에서 감싸므로 같은 방향으로 계속 돌려도 멈추지 않는다. */
export function nextChart(current: ChartType, step: number): ChartType {
  const len = CHART_TYPES.length;
  const i = CHART_TYPES.indexOf(current);
  return CHART_TYPES[(((i + step) % len) + len) % len] ?? DEFAULT_CHART;
}

/** 기준 전환. 2종뿐이라 순환이 아니라 뒤집기다. */
export function nextBasis(current: Basis): Basis {
  return current === 'used' ? 'remaining' : 'used';
}

export function resolveBasis(s: GaugeSettings | undefined): Basis {
  return s?.basis === 'remaining' || s?.basis === 'used' ? s.basis : DEFAULT_BASIS;
}

/**
 * 전역 설정의 폴링 간격을 ms 로 정규화한다. PI 의 숫자 입력은 문자열로 올 수 있고 사용자가
 * 임의값을 넣을 수 있으므로 여기서 clamp 한다 — 렌더나 네트워크 계층이 아니라 경계에서.
 */
export function resolvePollMs(s: GlobalSettings | undefined): number {
  const raw = Number(s?.pollIntervalSec);
  if (!Number.isFinite(raw)) {
    return DEFAULT_POLL_SEC * 1000;
  }
  return Math.min(Math.max(Math.round(raw), MIN_POLL_SEC), MAX_POLL_SEC) * 1000;
}
