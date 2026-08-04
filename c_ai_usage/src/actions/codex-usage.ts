import { action } from '@elgato/streamdeck';

import { GaugeActionBase } from './gauge-action';

/**
 * Codex 사용량 게이지.
 *
 * ⚠ 2026-07-13 이후 Codex 는 창을 1개(주간)만 반환하므로 **5HR 슬롯이 공란인 것이 정상**이다.
 * 공란은 `—` 로 그려져 0% 와 구분된다. OpenAI 가 5시간 창을 되살리면 길이 버킷팅이 코드 변경
 * 없이 채운다(ai-limits-plan.md §2).
 */
@action({ UUID: 'com.sonky.c-ai-usage.codex' })
export class CodexUsageAction extends GaugeActionBase {}
