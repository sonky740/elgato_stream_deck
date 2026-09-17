import streamDeck, {
  SingletonAction,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type SendToPluginEvent,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from '@elgato/streamdeck';

import { currentLang } from '../i18n';
import { renderGauge } from '../render/gauge';
import { PROBE_INTERVAL_MS, probeEnabled, probeStages } from '../render/probe';
import {
  nextBasis,
  nextChart,
  resolveBasis,
  resolveChart,
  resolveThresholds,
  type GaugeSettings,
} from '../settings';
import type { UsageService } from '../usage/service';
import type { UsageViewModel } from '../usage/types';

type GaugeAction = DialAction<GaugeSettings> | KeyAction<GaugeSettings>;

/** 터치스트립 레이아웃의 pixmap item key. layouts/usage.json 과 정확히 일치해야 한다. */
const CANVAS_KEY = 'canvas';

/**
 * 회전 스로틀 창. 한 번 휙 돌리면 `dialRotate` 가 연달아 도착해 차트가 여러 칸 튄다.
 *
 * debounce 가 아니라 **leading-edge throttle** 이다 — 첫 이벤트를 즉시 반영하고 창 안의
 * 나머지를 버린다. debounce 면 회전이 멎을 때까지 화면이 가만히 있어, 이 매핑을 순환으로
 * 되돌린 이유였던 "돌려도 반응이 없다" 가 되살아난다.
 */
export const ROTATE_THROTTLE_MS = 400;

/**
 * PI 의 수동 새로고침 명령. `ui/commands.js` 의 `data-send` 값과 같아야 한다 — 한쪽만 바꾸면
 * 버튼이 조용히 아무 일도 하지 않는다.
 */
export const REFRESH_COMMAND = 'refresh';

/** PI 가 이 채널로 보내는 메시지. sdpi 는 명령 이름을 `event` 에 담는다. */
type PiMessage = { event?: string };

/**
 * 사용량 게이지 액션의 공통 배관. 프로바이더별 서브클래스는 `@action({ UUID })` 만 붙인다 —
 * 프로바이더 차이는 전부 주입된 {@link UsageService} 뒤에 있다.
 *
 * 폴링 타이머를 갖지 않는다. 공유 서비스를 구독하고 값이 오면 그릴 뿐이다 — 인스턴스마다
 * 타이머를 두면 다이얼 2개를 올리는 순간 레이트리밋된 요청이 2배가 된다(SPEC "액션 인스턴스 수가 요청률에 영향을 주지 않는다").
 */
export abstract class GaugeActionBase extends SingletonAction<GaugeSettings> {
  readonly #service: UsageService;
  /** 인스턴스별 구독 해제 함수. */
  readonly #detachers = new Map<string, () => void>();
  /**
   * 인스턴스별 마지막 전송 페이로드. 같으면 재전송하지 않는다(수 KB 낭비 방지).
   *
   * 게이지에 남은 시간 카운트다운이 들어간 뒤로는 폴링마다 문구가 달라져 이 가드가 걸리는
   * 일이 드물다. 여전히 필요한 건 **설정 변경 경로** 다 — `#apply` 의 명시적 렌더와
   * `didReceiveSettings` 에코가 겹쳐 같은 페이로드를 두 번 보내는 것을 여기서 막는다.
   */
  readonly #lastSent = new Map<string, string>();
  /** 인스턴스별 마지막 뷰모델. 설정만 바뀌었을 때 네트워크 없이 다시 그리기 위해 보관한다. */
  readonly #lastVm = new Map<string, UsageViewModel>();
  /**
   * 인스턴스별 현재 설정. 구독 콜백이 `onWillAppear` 의 `ev.payload.settings` 를 캡처하면
   * appear 시점 스냅샷에 고정되어, 차트를 바꿔도 다음 폴링 렌더가 옛 설정으로 되돌린다.
   */
  readonly #settings = new Map<string, GaugeSettings>();
  /** 인스턴스별 마지막으로 **반영된** 회전 시각. 버린 이벤트로는 갱신하지 않는다. */
  readonly #lastRotateMs = new Map<string, number>();

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
    // subscribe 는 현재 값을 즉시 1회 흘리므로 설정을 먼저 넣어야 첫 렌더가 옳다.
    this.#settings.set(action.id, ev.payload.settings);
    this.#detachers.set(
      action.id,
      this.#service.subscribe((vm) => void this.#render(action, vm)),
    );
  }

  override onWillDisappear(ev: WillDisappearEvent<GaugeSettings>): void {
    this.#detach(ev.action.id);
    this.#lastSent.delete(ev.action.id);
    this.#lastVm.delete(ev.action.id);
    this.#settings.delete(ev.action.id);
    this.#lastRotateMs.delete(ev.action.id);
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
    this.#settings.set(action.id, ev.payload.settings);
    const vm = this.#lastVm.get(action.id);
    if (vm !== undefined) {
      void this.#render(action, vm);
    }
  }

  /**
   * PI 의 수동 새로고침 버튼. 새 값이 오면 구독 렌더가 알아서 그린다.
   *
   * 알 수 없는 메시지는 조용히 무시한다 — sdpi 의 dataSource 도 이 채널을 쓰므로 다른
   * 이벤트가 섞여 들어올 수 있다.
   */
  override onSendToPlugin(ev: SendToPluginEvent<PiMessage, GaugeSettings>): void {
    if (ev.payload?.event === REFRESH_COMMAND) {
      this.#service.refresh();
    }
  }

  /** 키 누름 → 차트 한 칸. 키에는 방향 정보가 없어 항상 정방향이다. */
  override async onKeyDown(ev: KeyDownEvent<GaugeSettings>): Promise<void> {
    await this.#cycleChart(ev.action, ev.payload.settings, 1);
  }

  /**
   * 다이얼 회전 → 회전 방향으로 차트 한 칸. 목록 양끝에서 감싸므로 같은 방향으로 계속 돌려도
   * 계속 바뀐다 — 조작마다 화면이 반응하는 것이 다이얼의 기대 동작이다.
   *
   * 한 번 휙 돌리면 이벤트가 연달아 오므로 {@link ROTATE_THROTTLE_MS} 로 비율을 제한한다.
   * 스텝도 `ticks` 크기가 아니라 방향(±1)이다 — 한 이벤트에 `ticks` 가 여러 개 실려 오는데
   * 차트가 2종이라 크기만큼 이동하면 짝수 입력이 제자리가 되어 반응이 없는 것처럼 보인다.
   */
  override async onDialRotate(ev: DialRotateEvent<GaugeSettings>): Promise<void> {
    const now = Date.now();
    const last = this.#lastRotateMs.get(ev.action.id);
    // 버린 이벤트로 시각을 갱신하지 않는다 — 갱신하면 계속 돌리는 동안 창이 밀려 영구히 막힌다.
    if (last !== undefined && now - last < ROTATE_THROTTLE_MS) {
      return;
    }
    this.#lastRotateMs.set(ev.action.id, now);
    await this.#cycleChart(ev.action, ev.payload.settings, Math.sign(ev.payload.ticks));
  }

  /** 다이얼 누름 → 기준 전환. 키는 누름을 이미 차트에 쓰므로 기준이 PI 전용으로 남는다. */
  override async onDialDown(ev: DialDownEvent<GaugeSettings>): Promise<void> {
    await this.#toggleBasis(ev.action, ev.payload.settings);
  }

  /** 터치스트립 탭 → 기준 전환. 누름과 같은 동작으로 둔다(media_controller 와 같은 관용구). */
  override async onTouchTap(ev: TouchTapEvent<GaugeSettings>): Promise<void> {
    await this.#toggleBasis(ev.action, ev.payload.settings);
  }

  async #cycleChart(action: GaugeAction, settings: GaugeSettings, step: number): Promise<void> {
    if (step === 0) {
      return;
    }
    await this.#apply(action, { ...settings, chart: nextChart(resolveChart(settings), step) });
  }

  async #toggleBasis(action: GaugeAction, settings: GaugeSettings): Promise<void> {
    await this.#apply(action, { ...settings, basis: nextBasis(resolveBasis(settings)) });
  }

  /**
   * 바뀐 설정을 저장하고 즉시 다시 그린다. 호출부가 `{ ...settings }` 를 펼쳐 넘겨야 한다 —
   * `setSettings` 는 인스턴스 설정을 통째로 덮어쓰므로 빠뜨린 필드는 날아간다.
   *
   * 플러그인 자신의 `setSettings` 가 `didReceiveSettings` 로 돌아온다는 보장이 없어 렌더를
   * 명시적으로 한다 — 돌아온다 해도 `#lastSent` 가 같은 페이로드를 걸러내므로 중복이 없다.
   */
  async #apply(action: GaugeAction, next: GaugeSettings): Promise<void> {
    this.#settings.set(action.id, next);
    await action.setSettings(next);
    const vm = this.#lastVm.get(action.id);
    if (vm !== undefined) {
      await this.#render(action, vm);
    }
  }

  #detach(id: string): void {
    const off = this.#detachers.get(id);
    if (off !== undefined) {
      off();
      this.#detachers.delete(id);
    }
  }

  async #render(action: GaugeAction, vm: UsageViewModel): Promise<void> {
    this.#lastVm.set(action.id, vm);
    const settings = this.#settings.get(action.id);
    const svg = renderGauge(
      vm,
      {
        surface: action.isDial() ? 'dial' : 'key',
        chart: resolveChart(settings),
        basis: resolveBasis(settings),
        thresholds: resolveThresholds(settings),
        lang: currentLang(),
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
      streamDeck.logger.warn('gauge render failed', err);
    }
  }
}

/**
 * 게이트 1 프로브를 순환시킨다. 각 SVG 는 자기 단계 번호를 ASCII 로 표시하므로 화면만 보고도
 * 어느 인코딩이 그려졌는지 알 수 있다 — 로그와 대조할 필요가 없다.
 */
const startProbe = (action: GaugeAction): (() => void) => {
  const stages = probeStages();
  let i = 0;
  const send = (): void => {
    const stage = stages[i % stages.length];
    i += 1;
    if (stage === undefined) {
      return;
    }
    streamDeck.logger.info(`[gate1] ${i}/${stages.length} ${stage.name} — ${stage.describe}`);
    const done = action.isDial()
      ? action.setFeedback({ [CANVAS_KEY]: stage.payload })
      : action.setImage(stage.payload);
    done.catch((err: unknown) => streamDeck.logger.warn(`[gate1] ${stage.name} send failed`, err));
  };
  send();
  const timer = setInterval(send, PROBE_INTERVAL_MS);
  return () => clearInterval(timer);
};

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
const encodeSvg = (svg: string): string => {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
};
