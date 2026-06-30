import streamDeck, {
  action,
  SingletonAction,
  type DialAction,
  type DialDownEvent,
  type DialRotateEvent,
  type KeyAction,
  type KeyDownEvent,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { MediaController } from '../media/types';

/** 같은 액션이 올라갈 수 있는 컨트롤러 — 다이얼(터치스트립) 또는 키. */
type MediaAction = DialAction | KeyAction;

/** 터치스트립/키에 표시하는 곡 정보 갱신 주기. */
const POLL_INTERVAL_MS = 1000;
/** 앨범 아트가 없을 때 다이얼 터치스트립에 보여줄 플러그인 내 기본 이미지. */
const FALLBACK_ART = 'imgs/actions/now-playing/encoder-icon';

/**
 * 현재 재생 중인 곡을 표시하고 제어하는 액션. Stream Deck + 다이얼과 일반 키를 모두 지원한다.
 * - 다이얼(터치스트립): 앨범 아트 + 제목 + 가수 + 앨범 표시 / 회전=이전·다음 / 누름·터치=재생·정지
 * - 키: 앨범 아트(이미지) + 제목(타이틀) 표시 / 누름=재생·정지 (이전·다음은 별도 Next/Previous 키 액션)
 *
 * 곡 정보는 컨트롤러 타입과 무관하게 동일한 1s 폴링으로 받아 surface 별로만 렌더가 갈린다.
 */
@action({ UUID: 'com.sonky.media-controller.now-playing' })
export class NowPlayingAction extends SingletonAction {
  readonly #media: MediaController;
  /** 인스턴스(다이얼/키)별 폴링 타이머. 같은 액션이 여러 곳에 올라가도 안전하게. */
  readonly #timers = new Map<string, NodeJS.Timeout>();
  /** 인스턴스별 마지막 렌더 시그니처. 변경 없으면 재전송을 건너뛴다. */
  readonly #lastSig = new Map<string, string>();

  constructor(media: MediaController) {
    super();
    this.#media = media;
  }

  override onWillAppear(ev: WillAppearEvent): void {
    const { action } = ev;
    // 다이얼/키만 지원한다(그 외 컨트롤러는 렌더 경로가 없으므로 무시).
    if (!action.isDial() && !action.isKey()) {
      return;
    }
    // disappear 없이 onWillAppear 가 다시 올 수 있다(프로필 전환/기기 깨어남). 기존 타이머를 정리해 누수를 막는다.
    const existing = this.#timers.get(action.id);
    if (existing !== undefined) {
      clearInterval(existing);
    }
    void this.#refresh(action);
    const timer = setInterval(() => void this.#refresh(action), POLL_INTERVAL_MS);
    this.#timers.set(action.id, timer);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    const timer = this.#timers.get(ev.action.id);
    if (timer !== undefined) {
      clearInterval(timer);
      this.#timers.delete(ev.action.id);
    }
    this.#lastSig.delete(ev.action.id);
    // 참고: 마지막 인스턴스가 사라져도 컨트롤러의 stream 자식 프로세스는 계속 살아 있다(재등장 시
    // 재기동 비용 회피를 위한 의도된 트레이드오프). 플러그인 종료 시 일괄 정리된다(darwin.ts #registerCleanup).
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    try {
      if (ev.payload.ticks > 0) {
        await this.#media.next();
      } else if (ev.payload.ticks < 0) {
        await this.#media.previous();
      }
      await this.#refresh(ev.action);
    } catch (err) {
      this.#showError(ev.action, err);
    }
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    await this.#togglePlay(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    await this.#togglePlay(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.#togglePlay(ev.action);
  }

  async #togglePlay(action: MediaAction): Promise<void> {
    try {
      await this.#media.playPause();
      await this.#refresh(action);
    } catch (err) {
      this.#showError(action, err);
    }
  }

  async #refresh(action: MediaAction): Promise<void> {
    try {
      const np = await this.#media.getNowPlaying();
      // 렌더 내용이 직전과 같으면 재전송하지 않는다(앨범아트 base64 재전송 방지).
      const sig = np === null ? 'none' : `${np.title} ${np.artist} ${np.album}`;
      if (this.#lastSig.get(action.id) === sig) {
        return;
      }
      this.#lastSig.set(action.id, sig);

      if (np === null) {
        await this.#render(action, '재생 없음', '', '', undefined);
        return;
      }
      await this.#render(action, np.title, np.artist, np.album, np.artworkDataUri);
    } catch (err) {
      this.#showError(action, err);
    }
  }

  /** surface 별 렌더: 다이얼은 터치스트립 레이아웃(setFeedback), 키는 이미지+타이틀. */
  async #render(
    action: MediaAction,
    title: string,
    artist: string,
    album: string,
    artUri: string | undefined,
  ): Promise<void> {
    if (action.isDial()) {
      await action.setFeedback({
        title,
        artist,
        album,
        albumArt: { value: artUri ?? FALLBACK_ART },
      });
      return;
    }
    // 키: 앨범 아트는 키 이미지로(없으면 manifest 기본 아이콘), 곡 제목은 타이틀로.
    await action.setImage(artUri);
    await action.setTitle(title);
  }

  #showError(action: MediaAction, err: unknown): void {
    streamDeck.logger.warn('media controller error', err);
    // 이미 에러 상태면 매 폴링마다 재전송하지 않는다(브리지 영구 실패 시 1s마다 throw 됨).
    if (this.#lastSig.get(action.id) === 'error') {
      return;
    }
    this.#lastSig.set(action.id, 'error');
    const onFail = (e: unknown): void => {
      streamDeck.logger.warn('에러 상태 렌더 실패', e);
    };
    if (action.isDial()) {
      action
        .setFeedback({
          title: '설정 필요',
          artist: 'CLAUDE.md 참고',
          album: '',
          albumArt: { value: FALLBACK_ART },
        })
        .catch(onFail);
      return;
    }
    action.setImage(undefined).catch(onFail);
    action.setTitle('설정 필요').catch(onFail);
  }
}
