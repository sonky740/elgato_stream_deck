/**
 * 현재 재생 중인 미디어의 상태. OS 미디어 세션에서 정규화한 형태로,
 * 플랫폼별 브리지(darwin / windows)가 이 모양으로 변환해 반환한다.
 */
export type NowPlaying = {
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  /** 앨범 아트. `data:image/...;base64,` data URI 또는 플러그인 내 이미지 경로. */
  artworkDataUri?: string;
};

/**
 * 미디어 제어 추상화. 컨슈머(액션)는 이 인터페이스에만 의존하고,
 * 플랫폼별 구현(MediaRemote on macOS / SMTC on Windows)은 뒤에 숨긴다.
 * "넓게는 media" — YouTube Music 외 다른 플레이어로 확장해도 컨슈머는 그대로다.
 */
export interface MediaController {
  /** 재생 정보가 없으면 `null`. */
  getNowPlaying(): Promise<NowPlaying | null>;
  playPause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
}
