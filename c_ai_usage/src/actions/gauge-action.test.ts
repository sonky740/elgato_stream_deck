import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GaugeActionBase, REFRESH_COMMAND, ROTATE_THROTTLE_MS } from './gauge-action';
import type { ChartType } from '../render/gauge';
import type { GaugeSettings } from '../settings';
import type { UsageService } from '../usage/service';
import type { UsageViewModel } from '../usage/types';

class TestAction extends GaugeActionBase {}

/** 전송된 페이로드와 저장된 설정을 기록하는 최소 액션. 실제 타입은 SDK 가 봉인돼 있어 캐스팅한다. */
const fakeAction = (surface: 'dial' | 'key') => {
  const sent: string[] = [];
  const saved: GaugeSettings[] = [];
  const action = {
    id: `test-${surface}`,
    isDial: () => surface === 'dial',
    isKey: () => surface === 'key',
    setImage(payload: string) {
      sent.push(payload);
      return Promise.resolve();
    },
    setFeedback(feedback: Record<string, string>) {
      sent.push(feedback['canvas'] ?? '');
      return Promise.resolve();
    },
    setSettings(settings: GaugeSettings) {
      saved.push(settings);
      return Promise.resolve();
    },
  };
  return { action, sent, saved };
};

const lastSvg = (sent: readonly string[]): string => {
  const payload = sent.at(-1) ?? '';
  return Buffer.from(payload.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString(
    'utf8',
  );
};

/**
 * 마지막으로 전송된 SVG 가 어느 차트인지. 도넛만 트랙을 **stroke** 로 그린다(세그먼트는 fill).
 *
 * `<circle>` 유무로 보면 안 된다 — 헤더의 프로바이더 점이 두 차트에 다 있다.
 */
const lastChart = (sent: readonly string[]): ChartType => {
  return lastSvg(sent).includes('stroke="#32363e"') ? 'donut' : 'bar';
};

const vm = (utilization = 37): UsageViewModel => {
  return {
    provider: 'claude',
    slots: {
      fiveHour: { label: '5H', durationSec: 18000, utilization, resetsAtMs: null },
      week: { label: 'WK', durationSec: 604800, utilization: 26, resetsAtMs: null },
    },
    state: 'ok',
    fetchedAtMs: Date.parse('2026-08-04T02:00:00Z'),
  };
};

const fakeService = (): {
  service: UsageService;
  push: (vm: UsageViewModel) => void;
  refreshes: () => number;
} => {
  const listeners = new Set<(vm: UsageViewModel) => void>();
  let refreshes = 0;
  return {
    service: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setIntervalMs() {},
      refresh() {
        refreshes += 1;
      },
    },
    push(vm) {
      for (const listener of listeners) {
        listener(vm);
      }
    },
    refreshes: () => refreshes,
  };
};

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK 이벤트/액션 타입을 최소 페이크로 대체한다 */
const appear = (action: unknown, settings: GaugeSettings): any => {
  return { action, payload: { settings } };
};

const rotation = (action: unknown, settings: GaugeSettings, ticks: number): any => {
  return { action, payload: { settings, ticks } };
};

const piMessage = (payload: unknown): any => {
  return { payload };
};

describe('GaugeActionBase 인터랙션', () => {
  // 회전 스로틀이 Date.now() 를 보므로 시계를 고정한다. 실시계로는 연속 회전이 전부
  // 스로틀 창에 들어가 테스트가 조작 횟수를 표현할 수 없다.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('키 누름이 차트를 순환시킨다', async () => {
    const { service, push } = fakeService();
    const { action, sent } = fakeAction('key');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, {}));
    push(vm());
    expect(lastChart(sent)).toBe('donut');

    await subject.onKeyDown(appear(action, {}));
    expect(lastChart(sent)).toBe('bar');

    await subject.onKeyDown(appear(action, { chart: 'bar' }));
    expect(lastChart(sent)).toBe('donut');
  });

  /**
   * 이 단정이 없으면 버그가 있는 코드도 통과한다. 구독 콜백이 appear 시점 설정을 캡처하고
   * 있으면 눌러서 바꾼 차트가 **다음 폴링에 옛 설정으로 되돌아간다** — 사용자에게는
   * "바꿨는데 잠시 뒤 풀린다" 로 보인다.
   */
  it('바꾼 차트가 다음 폴링 렌더에도 유지된다', async () => {
    const { service, push } = fakeService();
    const { action, sent } = fakeAction('key');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, {}));
    push(vm());
    await subject.onKeyDown(appear(action, {}));
    expect(lastChart(sent)).toBe('bar');

    // 값이 달라야 dedupe 를 통과해 실제로 다시 그려진다.
    push(vm(41));
    expect(lastChart(sent)).toBe('bar');
  });

  /**
   * 같은 방향으로 계속 돌리면 계속 순환해야 한다. 방향을 차트에 절대 배정하면 두 번째 회전이
   * 제자리가 되는데, 실기기에서 그게 "돌려도 가만히 있다" 로 읽혔다.
   */
  it('같은 방향으로 계속 돌려도 차트가 계속 순환한다', async () => {
    const { service, push } = fakeService();
    const { action, sent, saved } = fakeAction('dial');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, {}));
    push(vm());
    expect(lastChart(sent)).toBe('donut');

    // Stream Deck 은 이벤트마다 현재 설정을 실어 보내므로 마지막 저장값을 다시 넘긴다.
    const current = (): GaugeSettings => saved.at(-1) ?? {};
    // 스로틀 창을 넘겨가며 돌린다 — 사용자가 따로따로 돌린 상황이다.
    const turn = async (ticks: number): Promise<void> => {
      vi.advanceTimersByTime(ROTATE_THROTTLE_MS);
      await subject.onDialRotate(rotation(action, current(), ticks));
    };

    await turn(1);
    expect(lastChart(sent)).toBe('bar');
    await turn(1);
    expect(lastChart(sent)).toBe('donut');
    await turn(1);
    expect(lastChart(sent)).toBe('bar');

    // 반대로 돌려도 한 칸씩 움직인다.
    await turn(-1);
    expect(lastChart(sent)).toBe('donut');
  });

  /**
   * 휙 돌리면 `dialRotate` 가 연달아 도착해 차트가 여러 칸 튄다. leading-edge throttle 이라
   * 첫 이벤트는 즉시 반영되고(반응이 느려지지 않는다) 창 안의 나머지만 버려진다.
   */
  it('휙 돌려 이벤트가 연달아 와도 스로틀 창 안에서는 한 칸만 움직인다', async () => {
    const { service, push } = fakeService();
    const { action, sent, saved } = fakeAction('dial');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, {}));
    push(vm());

    await subject.onDialRotate(rotation(action, {}, 1));
    expect(lastChart(sent)).toBe('bar');

    // 같은 제스처의 후속 이벤트 — 창 안이므로 버린다.
    vi.advanceTimersByTime(ROTATE_THROTTLE_MS - 1);
    await subject.onDialRotate(rotation(action, { chart: 'bar' }, 1));
    await subject.onDialRotate(rotation(action, { chart: 'bar' }, 1));
    expect(saved).toHaveLength(1);
    expect(lastChart(sent)).toBe('bar');

    // 창을 넘기면 다시 받는다. 버린 이벤트가 창을 밀지 않기 때문이다 —
    // 밀면 계속 돌리는 동안 영구히 막힌다.
    vi.advanceTimersByTime(1);
    await subject.onDialRotate(rotation(action, { chart: 'bar' }, 1));
    expect(lastChart(sent)).toBe('donut');
  });

  /**
   * 빠르게 튕기면 한 이벤트에 ticks 가 여러 개 실린다. 크기만큼 이동하면 차트가 2종이라
   * 짝수 입력이 제자리가 되어 조작에 반응이 없는 것처럼 보인다 — 방향만 쓴다.
   */
  it('ticks 가 여러 개여도 한 칸만 움직인다', async () => {
    const { service, push } = fakeService();
    const { action, sent } = fakeAction('dial');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, {}));
    push(vm());
    await subject.onDialRotate(rotation(action, {}, 4));
    expect(lastChart(sent)).toBe('bar');
  });

  it('다이얼 누름과 터치가 기준을 전환하고 차트는 보존한다', async () => {
    const { service, push } = fakeService();
    const { action, sent, saved } = fakeAction('dial');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, { chart: 'bar' }));
    push(vm());
    expect(lastSvg(sent)).toContain('37%');

    await subject.onDialDown(appear(action, { chart: 'bar' }));
    expect(saved.at(-1)).toEqual({ chart: 'bar', basis: 'remaining' });
    expect(lastSvg(sent)).toContain('63%'); // 100 - 37

    await subject.onTouchTap(appear(action, saved.at(-1) ?? {}));
    expect(saved.at(-1)).toEqual({ chart: 'bar', basis: 'used' });
    expect(lastSvg(sent)).toContain('37%');
  });

  it('차트를 바꿀 때 basis 를 보존한다 — setSettings 는 설정을 통째로 덮어쓴다', async () => {
    const { service, push } = fakeService();
    const { action, saved } = fakeAction('key');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, { basis: 'remaining' }));
    push(vm());
    await subject.onKeyDown(appear(action, { basis: 'remaining' }));

    expect(saved).toEqual([{ basis: 'remaining', chart: 'bar' }]);
  });

  it('PI 의 새로고침 명령이 공유 서비스의 refresh 를 부른다', () => {
    const { service, refreshes } = fakeService();
    const subject = new TestAction(service);

    subject.onSendToPlugin(piMessage({ event: REFRESH_COMMAND }));
    expect(refreshes()).toBe(1);
  });

  /** sdpi 의 dataSource 도 같은 채널을 쓴다 — 모르는 메시지로 요청을 쏘면 안 된다. */
  it('알 수 없는 PI 메시지는 무시한다', () => {
    const { service, refreshes } = fakeService();
    const subject = new TestAction(service);

    subject.onSendToPlugin(piMessage({ event: 'getItems' }));
    subject.onSendToPlugin(piMessage(undefined));
    subject.onSendToPlugin(piMessage('refresh'));
    expect(refreshes()).toBe(0);
  });

  it('disappear 가 인스턴스 상태를 남기지 않는다', async () => {
    const { service, push } = fakeService();
    const { action, sent } = fakeAction('key');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, { chart: 'bar' }));
    push(vm());
    subject.onWillDisappear(appear(action, { chart: 'bar' }));

    // 설정이 지워졌으므로 다시 나타나기 전의 렌더는 기본값(도넛)으로 떨어진다.
    const before = sent.length;
    push(vm(55));
    expect(sent).toHaveLength(before);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
