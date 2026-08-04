import streamDeck, {
  SingletonAction,
  type DialAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from '@elgato/streamdeck';

import { renderGauge } from '../render/gauge';
import { PROBE_INTERVAL_MS, probeEnabled, probeStages } from '../render/probe';
import { resolveBasis, resolveChart, type GaugeSettings } from '../settings';
import type { UsageService } from '../usage/service';
import type { UsageViewModel } from '../usage/types';

type GaugeAction = DialAction<GaugeSettings> | KeyAction<GaugeSettings>;

/** 터치스트립 레이아웃의 pixmap item key. layouts/usage.json 과 정확히 일치해야 한다. */
const CANVAS_KEY = 'canvas';

/**
 * 사용량 게이지 액션의 공통 배관. 프로바이더별 서브클래스는 `@action({ UUID })` 만 붙인다 —
 * 프로바이더 차이는 전부 주입된 {@link UsageService} 뒤에 있다.
 *
 * 폴링 타이머를 갖지 않는다. 공유 서비스를 구독하고 값이 오면 그릴 뿐이다 — 인스턴스마다
 * 타이머를 두면 다이얼 2개를 올리는 순간 레이트리밋된 요청이 2배가 된다(§5).
 */
export abstract class GaugeActionBase extends SingletonAction<GaugeSettings> {
  readonly #service: UsageService;
  /** 인스턴스별 구독 해제 함수. */
  readonly #detachers = new Map<string, () => void>();
  /** 인스턴스별 마지막 전송 페이로드. 같으면 재전송하지 않는다(수 KB 낭비 방지). */
  readonly #lastSent = new Map<string, string>();
  /** 인스턴스별 마지막 뷰모델. 설정만 바뀌었을 때 네트워크 없이 다시 그리기 위해 보관한다. */
  readonly #lastVm = new Map<string, UsageViewModel>();

  constructor(service: UsageService) {
    super();
    this.#service = service;
  }

  override onWillAppear(ev: WillAppearEvent<GaugeSettings>): void {
    const { action } = ev;
    if (!action.isDial() && !action.isKey()) {
      return;
    }
    // disappear 없이 onWillAppear 가 다시 올 수 있다(프로필 전환/기기 깨어남). 기존 구독을 끊어 누수를 막는다.
    this.#detach(action.id);
    if (probeEnabled()) {
      this.#detachers.set(action.id, startProbe(action));
      return;
    }
    this.#detachers.set(
      action.id,
      this.#service.subscribe((vm) => void this.#render(action, vm, ev.payload.settings)),
    );
  }

  override onWillDisappear(ev: WillDisappearEvent<GaugeSettings>): void {
    this.#detach(ev.action.id);
    this.#lastSent.delete(ev.action.id);
    this.#lastVm.delete(ev.action.id);
  }

  /**
   * PI 에서 차트·기준을 바꿨을 때. 마지막 뷰모델로 즉시 다시 그린다 — 새 폴링을 기다리면
   * 최대 폴링 간격(기본 300s)만큼 화면이 안 바뀌어 설정이 먹지 않은 것처럼 보인다.
   */
  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<GaugeSettings>): void {
    const { action } = ev;
    if (!action.isDial() && !action.isKey()) {
      return;
    }
    const vm = this.#lastVm.get(action.id);
    if (vm !== undefined) {
      void this.#render(action, vm, ev.payload.settings);
    }
  }

  #detach(id: string): void {
    const off = this.#detachers.get(id);
    if (off !== undefined) {
      off();
      this.#detachers.delete(id);
    }
  }

  async #render(action: GaugeAction, vm: UsageViewModel, settings: GaugeSettings): Promise<void> {
    this.#lastVm.set(action.id, vm);
    const svg = renderGauge(
      vm,
      {
        surface: action.isDial() ? 'dial' : 'key',
        chart: resolveChart(settings),
        basis: resolveBasis(settings),
      },
      Date.now(),
    );
    const payload = encodeSvg(svg);
    if (this.#lastSent.get(action.id) === payload) {
      return;
    }
    this.#lastSent.set(action.id, payload);
    try {
      if (action.isDial()) {
        await action.setFeedback({ [CANVAS_KEY]: payload });
        return;
      }
      // 키에서는 SVG 안에 이미 퍼센트를 그렸으므로 setTitle 을 호출하지 않는다 — 호출하면 겹친다.
      await action.setImage(payload);
    } catch (err) {
      // 렌더 실패는 다음 값에서 다시 시도된다. 시그니처는 되돌려 재시도를 막지 않게 한다.
      this.#lastSent.delete(action.id);
      streamDeck.logger.warn('게이지 렌더 실패', err);
    }
  }
}

/**
 * 게이트 1 프로브를 순환시킨다. 각 SVG 는 자기 단계 번호를 ASCII 로 표시하므로 화면만 보고도
 * 어느 인코딩이 그려졌는지 알 수 있다 — 로그와 대조할 필요가 없다.
 */
function startProbe(action: GaugeAction): () => void {
  const stages = probeStages();
  let i = 0;
  const send = (): void => {
    const stage = stages[i % stages.length];
    i += 1;
    if (stage === undefined) {
      return;
    }
    streamDeck.logger.info(`[게이트1] ${i}/${stages.length} ${stage.name} — ${stage.describe}`);
    const done = action.isDial()
      ? action.setFeedback({ [CANVAS_KEY]: stage.payload })
      : action.setImage(stage.payload);
    done.catch((err: unknown) => streamDeck.logger.warn(`[게이트1] ${stage.name} 전송 실패`, err));
  };
  send();
  const timer = setInterval(send, PROBE_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * SVG 를 Stream Deck 이 받는 형식으로 감싼다.
 *
 * **raw `<svg …>` 문자열은 pixmap 에서 그려지지 않는다** — 실기기 확인 결과다(2026-08-04).
 * Elgato 의 layout 스키마는 pixmap `value` 가 "a path …, a base64 encoded `string` …, or an
 * SVG `string`" 을 받는다고 적었지만 raw 문자열은 빈 화면이 되고 전송 오류도 나지 않는다.
 * 값이 경로로 먼저 해석되어 해석 실패로 끝나는 것으로 보인다(스키마 설명의 첫 항목이 경로다).
 *
 * base64 data URI 는 같은 스키마의 워크드 예시 형식이고 실기기에서 확인됐다.
 */
function encodeSvg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
