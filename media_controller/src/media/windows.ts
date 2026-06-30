import streamDeck from '@elgato/streamdeck';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { MediaController, NowPlaying } from './types';

const execFileAsync = promisify(execFile);

/**
 * Windows 미디어 브리지 — vendored SMTC 헬퍼(.NET)를 out-of-process로 구동한다.
 *
 * Stream Deck 플러그인은 앱이 번들한 Node 24 에서 돌아, WinRT 네이티브 애드온(NodeRT)을
 * 그 ABI에 맞춰 빌드·번들하기가 취약하다. 그래서 macOS(mediaremote-adapter)와 같은 구조로
 * `Windows.Media.Control`(SMTC)를 호출하는 작은 헬퍼 exe 에 shell out 한다.
 *
 * 헬퍼 계약 (smtc-helper/Program.cs):
 *   - `smtc-helper stream` : SMTC 변경 시마다 한 줄 JSON(payload 또는 "null")을 stdout 출력
 *   - `smtc-helper send <playpause|next|previous>` : 현재 세션에 제어 명령 전달
 *   payload 키: title/artist/album/playing(bool)/artworkData(base64)/artworkMimeType
 *
 * 빌드/vendor: scripts/build-smtc-helper.ps1 (Windows + .NET SDK 필요). 저장소 루트 CLAUDE.md 참고.
 *
 * ⚠️ 이 브리지는 Windows 에서 아직 검증되지 않았다(코드/구조만 작성). darwin.ts 와 동일한
 *    수명·서킷브레이커·정리 패턴을 따른다.
 */

const CMD_PLAY_PAUSE = 'playpause';
const CMD_NEXT = 'next';
const CMD_PREVIOUS = 'previous';

// 번들 레이아웃: <.sdPlugin>/bin/plugin.js → vendor 는 ../vendor/...
const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'smtc-helper');
const HELPER_EXE = join(VENDOR_DIR, 'smtc-helper.exe');

// 헬퍼가 이 시간 미만으로 살다 죽으면 "즉시 실패"로 본다(미빌드/경로/런타임 문제).
const MIN_HEALTHY_RUN_MS = 3000;
// 즉시 실패가 연속 이만큼이면 브리지를 영구 비활성화(초당 재기동 루프 차단).
const MAX_FAST_FAILURES = 3;

type HelperPayload = {
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  artworkData?: string;
  artworkMimeType?: string;
};

function toNowPlaying(payload: HelperPayload | null | undefined): NowPlaying | null {
  if (!payload || typeof payload.title !== 'string' || payload.title.length === 0) {
    return null;
  }
  const artworkDataUri =
    payload.artworkData && payload.artworkMimeType
      ? `data:${payload.artworkMimeType};base64,${payload.artworkData}`
      : undefined;
  return {
    title: payload.title,
    artist: payload.artist ?? '',
    album: payload.album ?? '',
    isPlaying: payload.playing === true,
    artworkDataUri,
  };
}

export class WindowsMediaController implements MediaController {
  #stream: ChildProcessWithoutNullStreams | undefined;
  #current: NowPlaying | null = null;
  #cleanupRegistered = false;
  #bridgeFailed = false;
  #fastFailures = 0;
  #spawnedAt = 0;

  async getNowPlaying(): Promise<NowPlaying | null> {
    if (this.#bridgeFailed) {
      throw new Error(
        'Windows SMTC 헬퍼를 시작할 수 없습니다 — 헬퍼가 빌드되어 vendor/smtc-helper 에 있는지 확인하세요 (scripts/build-smtc-helper.ps1, CLAUDE.md 참고).',
      );
    }
    this.#ensureStream();
    return this.#current;
  }

  playPause(): Promise<void> {
    return this.#send(CMD_PLAY_PAUSE);
  }

  next(): Promise<void> {
    return this.#send(CMD_NEXT);
  }

  previous(): Promise<void> {
    return this.#send(CMD_PREVIOUS);
  }

  async #send(command: string): Promise<void> {
    await execFileAsync(HELPER_EXE, ['send', command], { timeout: 5000 });
  }

  /**
   * 곡 정보 변경을 푸시받는 영속 `stream` 헬퍼를 (없으면) 띄운다.
   * 정상 가동 후 죽으면 다음 폴링에 재기동(self-heal), 즉시 실패가 반복되면 비활성화.
   */
  #ensureStream(): void {
    if (this.#stream || this.#bridgeFailed) {
      return;
    }
    this.#registerCleanup();

    const child = spawn(HELPER_EXE, ['stream']);
    this.#stream = child;
    this.#spawnedAt = Date.now();

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (line.length === 0) {
        return;
      }
      let payload: HelperPayload | null;
      try {
        payload = JSON.parse(line) as HelperPayload | null;
      } catch {
        streamDeck.logger.trace(`[smtc-helper] 비JSON 출력 무시: ${line.slice(0, 120)}`);
        return;
      }
      this.#current = toNowPlaying(payload);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      streamDeck.logger.warn(`[smtc-helper] ${chunk.toString().trim()}`);
    });

    const onGone = () => {
      rl.close();
      if (this.#stream !== child) {
        return;
      }
      this.#stream = undefined;
      this.#current = null;
      if (Date.now() - this.#spawnedAt < MIN_HEALTHY_RUN_MS) {
        this.#fastFailures += 1;
        if (this.#fastFailures >= MAX_FAST_FAILURES) {
          this.#bridgeFailed = true;
          streamDeck.logger.error(
            `[smtc-helper] ${MAX_FAST_FAILURES}회 연속 즉시 종료 — 브리지를 비활성화합니다.`,
          );
        }
      } else {
        this.#fastFailures = 0;
      }
    };
    child.on('exit', onGone);
    child.on('error', (err) => {
      streamDeck.logger.error(`[smtc-helper] spawn 실패: ${err.message}`);
      onGone();
    });
  }

  /** 플러그인 프로세스 종료 시 헬퍼 자식을 함께 정리해 orphan 을 막는다. */
  #registerCleanup(): void {
    if (this.#cleanupRegistered) {
      return;
    }
    this.#cleanupRegistered = true;
    const cleanup = () => this.#stream?.kill();
    process.once('exit', cleanup);
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.once(sig, () => {
        cleanup();
        process.exit(0);
      });
    }
  }
}
