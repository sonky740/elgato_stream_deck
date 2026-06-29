import streamDeck from "@elgato/streamdeck";

import { NowPlayingAction } from "./actions/now-playing";

// 개발 중에는 Stream Deck ↔ 플러그인 간 모든 메시지를 기록한다.
streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new NowPlayingAction());

streamDeck.connect();
