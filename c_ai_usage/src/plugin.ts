import streamDeck from '@elgato/streamdeck';

import { ClaudeUsageAction } from './actions/claude-usage';
import { CodexUsageAction } from './actions/codex-usage';
import { resolvePollMs, type GlobalSettings } from './settings';
import { ClaudeSource } from './usage/claude';
import { CodexSource } from './usage/codex';
import { fakeSourceFromEnv } from './usage/fake';
import { createUsageService } from './usage/service';

// trace 를 쓰지 않는다 — Codex 사용량 응답 본문에 email 등 PII 가 평문으로 실려 로그 파일로 새어나간다
// (ai-limits-plan.md §4.2 · §10). 응답 본문은 어떤 레벨에서도 그대로 기록하지 않는다.
streamDeck.logger.setLevel('info');

/** 이 나이를 넘은 마지막 성공값은 더 보여주지 않고 실패 상태를 그대로 드러낸다. */
const STALE_LIMIT_MS = 30 * 60_000;

// C_AI_USAGE_FAKE 가 설정돼 있으면 가짜 소스를 쓴다 — 실패 상태 11종은 실제 서버를 그 상태로
// 만들 수 없어 라이브로는 확인이 불가능하다(usage/fake.ts).
if (process.env['C_AI_USAGE_FAKE'] !== undefined) {
  streamDeck.logger.info(`source: fake (C_AI_USAGE_FAKE=${process.env['C_AI_USAGE_FAKE']})`);
}

// 프로바이더당 서비스 1개. 분리하는 이유는 한쪽의 429·서킷 오픈이 다른 쪽 폴링을 멈추지
// 않게 하기 위해서다.
//
// 폴링 간격은 기본값으로 만들어 두고 전역 설정이 도착하면 갈아끼운다. 전역 설정은 connect()
// 이후에만 읽을 수 있지만 폴링은 액션이 나타나 구독할 때 시작되므로 순서 문제가 없다 —
// 최악의 경우 첫 1회만 기본 간격으로 돈다.
const options = { intervalMs: resolvePollMs(undefined), staleLimitMs: STALE_LIMIT_MS };
const claude = createUsageService(fakeSourceFromEnv('claude') ?? new ClaudeSource(), options);
const codex = createUsageService(fakeSourceFromEnv('codex') ?? new CodexSource(), options);

streamDeck.logger.info('svg encoding: base64 data URI (raw SVG 는 pixmap 에서 안 그려짐)');
streamDeck.actions.registerAction(new ClaudeUsageAction(claude));
streamDeck.actions.registerAction(new CodexUsageAction(codex));

function applyPollInterval(settings: GlobalSettings | undefined): void {
  const ms = resolvePollMs(settings);
  claude.setIntervalMs(ms);
  codex.setIntervalMs(ms);
}

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
  applyPollInterval(ev.settings);
});

await streamDeck.connect();

applyPollInterval(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
