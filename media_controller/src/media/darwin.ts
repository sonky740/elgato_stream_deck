import streamDeck from '@elgato/streamdeck';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { MediaController, NowPlaying } from './types';

const execFileAsync = promisify(execFile);

/**
 * macOS 미디어 브리지 — vendor된 `ungive/mediaremote-adapter`를 out-of-process로 구동한다.
 *
 * macOS 15.4+ 는 앱 내부에서 `MRMediaRemoteGetNowPlayingInfo`를 호출하면 nil 을 반환하므로,
 * 시스템 바이너리(`/usr/bin/perl`)가 MediaRemote 프레임워크를 동적 로드하는 어댑터를 별도
 * 프로세스로 실행해 곡 정보와 제어를 얻는다. 빌드/vendor 내역은 저장소 루트 CLAUDE.md 참고.
 */

// MRACommand IDs (include/MediaRemoteAdapter.h)
const CMD_TOGGLE_PLAY_PAUSE = 2;
const CMD_NEXT_TRACK = 4;
const CMD_PREVIOUS_TRACK = 5;

const PERL = '/usr/bin/perl';

// 번들 레이아웃: <.sdPlugin>/bin/plugin.js → vendor 는 ../vendor/...
const VENDOR_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'vendor',
  'mediaremote-adapter',
);
const ADAPTER_PL = join(VENDOR_DIR, 'mediaremote-adapter.pl');
const FRAMEWORK = join(VENDOR_DIR, 'MediaRemoteAdapter.framework');

// stream 이 이 시간 미만으로 살다 죽으면 "즉시 실패"로 본다(설정/서명/경로 문제).
const MIN_HEALTHY_RUN_MS = 3000;
// 즉시 실패가 연속 이만큼이면 브리지를 영구 비활성화(초당 재기동 루프 차단).
const MAX_FAST_FAILURES = 3;

/** 어댑터 `stream`/`get` payload 를 정규화한다. 재생 정보가 없으면 null. */
type AdapterPayload = {
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  artworkData?: string;
  artworkMimeType?: string;
};

const toNowPlaying = (payload: AdapterPayload | null | undefined): NowPlaying | null => {
  // 어댑터의 필수 키는 title/playing/processIdentifier. title 이 없으면 재생 정보 없음.
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
};

export class DarwinMediaController implements MediaController {
  #stream: ChildProcessWithoutNullStreams | undefined;
  #current: NowPlaying | null = null;
  #cleanupRegistered = false;
  /** 즉시 실패가 누적돼 영구 비활성화된 상태. getNowPlaying 이 에러를 던져 컨슈머가 알 수 있게 한다. */
  #bridgeFailed = false;
  #fastFailures = 0;
  #spawnedAt = 0;

  async getNowPlaying(): Promise<NowPlaying | null> {
    if (this.#bridgeFailed) {
      throw new Error(
        'Cannot start the macOS media bridge — check the vendor path and the framework signature (see CLAUDE.md).',
      );
    }
    this.#ensureStream();
    return this.#current;
  }

  playPause(): Promise<void> {
    return this.#send(CMD_TOGGLE_PLAY_PAUSE);
  }

  next(): Promise<void> {
    return this.#send(CMD_NEXT_TRACK);
  }

  previous(): Promise<void> {
    return this.#send(CMD_PREVIOUS_TRACK);
  }

  async #send(command: number): Promise<void> {
    await execFileAsync(PERL, [ADAPTER_PL, FRAMEWORK, 'send', String(command)], { timeout: 5000 });
  }

  /**
   * 곡 정보 변경을 푸시받는 영속 `stream` 프로세스를 (없으면) 띄운다.
   * 정상 가동 후 죽으면(절전/깨어남 등) 다음 폴링에 재기동하고(self-heal), 즉시 실패가
   * 반복되면(MAX_FAST_FAILURES) #bridgeFailed 로 전환해 재기동 루프를 끊는다.
   */
  #ensureStream(): void {
    if (this.#stream || this.#bridgeFailed) {
      return;
    }
    this.#registerCleanup();

    const child = spawn(PERL, [ADAPTER_PL, FRAMEWORK, 'stream', '--no-diff', '--debounce=250']);
    this.#stream = child;
    this.#spawnedAt = Date.now();

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (line.length === 0) {
        return;
      }
      let msg: { type?: string; payload?: AdapterPayload };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        streamDeck.logger.trace(
          `[mediaremote-adapter] ignoring non-JSON output: ${line.slice(0, 120)}`,
        );
        return;
      }
      if (msg.type === 'data') {
        this.#current = toNowPlaying(msg.payload);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      streamDeck.logger.warn(`[mediaremote-adapter] ${chunk.toString().trim()}`);
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
            `[mediaremote-adapter] exited immediately ${MAX_FAST_FAILURES} times in a row — disabling the bridge.`,
          );
        }
      } else {
        this.#fastFailures = 0; // 정상 가동 후 종료 → 재기동 허용
      }
    };
    child.on('exit', onGone);
    child.on('error', (err) => {
      streamDeck.logger.error(`[mediaremote-adapter] spawn failed: ${err.message}`);
      onGone();
    });
  }

  /** 플러그인 프로세스 종료 시 스트림 자식을 함께 정리해 orphan 을 막는다. */
  #registerCleanup(): void {
    if (this.#cleanupRegistered) {
      return;
    }
    this.#cleanupRegistered = true;
    const cleanup = () => this.#stream?.kill('SIGTERM');
    // 정상 종료 경로.
    process.once('exit', cleanup);
    // 시그널 핸들러는 자식 정리 후 반드시 종료해야 한다. 핸들러만 등록하고 exit 하지 않으면
    // Node 가 해당 시그널에서 더 이상 종료되지 않아(SDK 웹소켓이 루프를 살림) 앱이 SIGKILL 로
    // 에스컬레이트 → 자식이 오히려 orphan 이 된다.
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.once(sig, () => {
        cleanup();
        process.exit(0);
      });
    }
  }
}
