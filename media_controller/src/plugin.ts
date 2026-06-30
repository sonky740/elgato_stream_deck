import streamDeck from '@elgato/streamdeck';

import { NextAction } from './actions/next';
import { NowPlayingAction } from './actions/now-playing';
import { PreviousAction } from './actions/previous';
import { createMediaController } from './media/controller';

// 개발 중에는 Stream Deck ↔ 플러그인 간 모든 메시지를 기록한다.
streamDeck.logger.setLevel('trace');

// 하나의 OS 미디어 세션 = 하나의 컨트롤러. 세 액션이 공유한다(중복 stream 프로세스 방지).
const media = createMediaController();
streamDeck.actions.registerAction(new NowPlayingAction(media));
streamDeck.actions.registerAction(new NextAction(media));
streamDeck.actions.registerAction(new PreviousAction(media));

streamDeck.connect();
