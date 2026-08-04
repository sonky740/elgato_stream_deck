import { action } from '@elgato/streamdeck';

import { GaugeActionBase } from './gauge-action';

/**
 * Claude 사용량 게이지. 다이얼(터치스트립)과 키를 모두 지원한다.
 * 배관은 {@link GaugeActionBase}, 프로바이더 차이는 주입된 서비스 뒤에 있다.
 */
@action({ UUID: 'com.sonky.c-ai-usage.claude' })
export class ClaudeUsageAction extends GaugeActionBase {}
