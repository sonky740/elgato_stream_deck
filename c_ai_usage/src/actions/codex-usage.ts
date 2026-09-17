import { action } from '@elgato/streamdeck';

import { GaugeActionBase } from './gauge-action';

/**
 * Codex 사용량 게이지. ⚠ 2026-07-13 이후 Codex 는 창을 1개(주간)만 반환하므로 **5HR 슬롯이
 * 공란인 것이 정상**이고, 공란은 `—` 로 그려져 0% 와 구분된다
 * (SPEC "슬롯은 2개 고정, 채울 데이터가 없으면 공란").
 */
@action({ UUID: 'com.sonky.c-ai-usage.codex' })
export class CodexUsageAction extends GaugeActionBase {}
