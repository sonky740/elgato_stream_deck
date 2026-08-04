import streamDeck from '@elgato/streamdeck';

import { ClaudeUsageAction } from './actions/claude-usage';
import { ClaudeSource } from './usage/claude';
import { fakeSourceFromEnv } from './usage/fake';
import { createUsageService } from './usage/service';

// trace 를 쓰지 않는다 — Codex 사용량 응답 본문에 email 등 PII 가 평문으로 실려 로그 파일로 새어나간다
// (ai-limits-plan.md §4.2 · §10). 응답 본문은 어떤 레벨에서도 그대로 기록하지 않는다.
streamDeck.logger.setLevel('info');

/**
 * 폴링 간격. 게이트 2 에서 60s 간격 12회가 429 없이 통과했지만 그 최솟값을 쓰지 않는다 —
 * 표본이 6분짜리라 시간 단위 지속 가능성의 증거가 아니고, 이 게이지에 60s 해상도가 필요하지도 않다.
 * 300s 는 Claude Code 자체의 usage 캐시 재기록 간격과 같고, 정상 동작 중인 codex-usage 플러그인의
 * 기본값과도 일치한다(ai-limits-plan.md §7 게이트 2).
 */
const POLL_INTERVAL_MS = 300_000;

/** 이 나이를 넘은 마지막 성공값은 더 보여주지 않고 실패 상태를 그대로 드러낸다. */
const STALE_LIMIT_MS = 30 * 60_000;

// 프로바이더당 서비스 1개를 액션에 주입한다. 프로바이더별로 분리하는 이유는 한쪽의 429 가
// 다른 쪽 폴링을 멈추지 않게 하기 위해서다(Codex 는 Phase 3).
//
// C_AI_USAGE_FAKE 가 설정돼 있으면 가짜 소스를 쓴다 — 실패 상태 11종은 실제 서버를 그 상태로
// 만들 수 없어 라이브로는 확인이 불가능하다(usage/fake.ts).
const fake = fakeSourceFromEnv('claude');
if (fake !== null) {
  streamDeck.logger.info(
    `claude source: fake (C_AI_USAGE_FAKE=${process.env['C_AI_USAGE_FAKE'] ?? ''})`,
  );
}
const claude = createUsageService(fake ?? new ClaudeSource(), {
  intervalMs: POLL_INTERVAL_MS,
  staleLimitMs: STALE_LIMIT_MS,
});

streamDeck.actions.registerAction(new ClaudeUsageAction(claude));

streamDeck.connect();
