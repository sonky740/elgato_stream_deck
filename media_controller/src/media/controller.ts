import type { MediaController } from './types';
import { DarwinMediaController } from './darwin';
import { WindowsMediaController } from './windows';

/**
 * 실행 중인 OS에 맞는 {@link MediaController} 구현을 반환한다.
 * 이 함수가 유일한 플랫폼 분기 지점이다 — 액션 코드는 플랫폼을 알지 못한다.
 */
export function createMediaController(): MediaController {
  switch (process.platform) {
    case 'darwin':
      return new DarwinMediaController();
    case 'win32':
      return new WindowsMediaController();
    default:
      throw new Error(`지원하지 않는 플랫폼입니다: ${process.platform}`);
  }
}
