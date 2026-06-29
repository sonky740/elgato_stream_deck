import type { MediaController, NowPlaying } from "./types";

/**
 * Windows 미디어 브리지 (미연결 스텁).
 *
 * Windows 는 `GlobalSystemMediaTransportControlsSessionManager`(SMTC) 로 곡 정보와
 * 제어를 모두 제공한다 — 브라우저의 YouTube Music 포함 거의 모든 플레이어 대상.
 *
 * Roadmap: SMTC 를 Node 에서 호출 (예: NodeRT `windows.media.control`, 또는 소형 네이티브
 * 애드온/헬퍼). 세션의 MediaProperties → {@link NowPlaying} 정규화, TryTogglePlayPause /
 * TrySkipNext / TrySkipPrevious 로 제어. 자세한 단계는 CLAUDE.md "Roadmap" 참고.
 */
const UNWIRED = "Windows 미디어 브리지가 아직 연결되지 않았습니다 (SMTC). CLAUDE.md의 Roadmap 참고.";

export class WindowsMediaController implements MediaController {
	async getNowPlaying(): Promise<NowPlaying | null> {
		return null;
	}

	playPause(): Promise<void> {
		throw new Error(UNWIRED);
	}

	next(): Promise<void> {
		throw new Error(UNWIRED);
	}

	previous(): Promise<void> {
		throw new Error(UNWIRED);
	}
}
