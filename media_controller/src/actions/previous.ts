import streamDeck, { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";

import type { MediaController } from "../media/types";

/**
 * 이전 곡으로 넘기는 키 전용 액션. 누르면 현재 OS 미디어 세션에 PreviousTrack 명령을 보낸다.
 * 곡 정보를 표시하지 않으므로 폴링/렌더가 없다 — Now Playing 다이얼의 반시계 회전과 같은 동작.
 */
@action({ UUID: "com.sonky.media-controller.previous" })
export class PreviousAction extends SingletonAction {
	readonly #media: MediaController;

	constructor(media: MediaController) {
		super();
		this.#media = media;
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		try {
			await this.#media.previous();
		} catch (err) {
			streamDeck.logger.warn("previous 실패", err);
			await ev.action.showAlert();
		}
	}
}
