import { describe, expect, it } from 'vitest';

import { GaugeActionBase } from './gauge-action';
import type { ChartType } from '../render/gauge';
import type { GaugeSettings } from '../settings';
import type { UsageService } from '../usage/service';
import type { UsageViewModel } from '../usage/types';

class TestAction extends GaugeActionBase {}

function fakeService(): { service: UsageService; push: (vm: UsageViewModel) => void } {
  const listeners = new Set<(vm: UsageViewModel) => void>();
  return {
    service: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setIntervalMs() {},
    },
    push(vm) {
      for (const listener of listeners) {
        listener(vm);
      }
    },
  };
}

/** 전송된 페이로드와 저장된 설정을 기록하는 최소 액션. 실제 타입은 SDK 가 봉인돼 있어 캐스팅한다. */
function fakeAction(surface: 'dial' | 'key') {
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
}

/** 마지막으로 전송된 SVG 가 어느 차트인지. 도넛만 `<circle>` 로 링을 그린다. */
function lastChart(sent: readonly string[]): ChartType {
  const payload = sent.at(-1) ?? '';
  const svg = Buffer.from(payload.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString(
    'utf8',
  );
  return svg.includes('<circle') ? 'donut' : 'bar';
}

function vm(utilization = 37): UsageViewModel {
  return {
    provider: 'claude',
    slots: {
      fiveHour: { label: '5H', durationSec: 18000, utilization, resetsAtMs: null },
      week: { label: 'WK', durationSec: 604800, utilization: 26, resetsAtMs: null },
    },
    state: 'ok',
    fetchedAtMs: Date.parse('2026-08-04T02:00:00Z'),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK 이벤트/액션 타입을 최소 페이크로 대체한다 */
function appear(action: unknown, settings: GaugeSettings): any {
  return { action, payload: { settings } };
}

describe('GaugeActionBase 인터랙션', () => {
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

  it('회전 방향이 차트를 절대 배정하고 같은 방향 반복은 멱등이다', async () => {
    const { service, push } = fakeService();
    const { action, sent, saved } = fakeAction('dial');
    const subject = new TestAction(service);

    subject.onWillAppear(appear(action, {}));
    push(vm());
    expect(lastChart(sent)).toBe('donut');

    await subject.onDialRotate({ action, payload: { settings: {}, ticks: 1 } } as any);
    expect(lastChart(sent)).toBe('bar');

    // 이미 바면 저장도 렌더도 하지 않는다 — 몇 칸을 더 돌려도 흔들리지 않는다.
    await subject.onDialRotate({
      action,
      payload: { settings: { chart: 'bar' }, ticks: 3 },
    } as any);
    expect(saved).toHaveLength(1);
    expect(lastChart(sent)).toBe('bar');

    await subject.onDialRotate({
      action,
      payload: { settings: { chart: 'bar' }, ticks: -1 },
    } as any);
    expect(lastChart(sent)).toBe('donut');
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
