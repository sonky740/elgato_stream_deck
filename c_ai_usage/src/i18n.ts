/**
 * 화면 문구의 언어. Stream Deck 이 지원하는 8개 언어 중 `ko` 만 한국어이고 나머지는 전부
 * 영어로 접는다 — 영어가 폴백이라는 뜻이며, 매니페스트 로컬라이제이션도 같은 규칙이다
 * (`ko.json` 만 두고 나머지 언어는 매니페스트 원문 = 영어를 그대로 쓴다).
 */
export type Lang = 'ko' | 'en';

export function resolveLang(appLanguage: string): Lang {
  return appLanguage === 'ko' ? 'ko' : 'en';
}

/**
 * 현재 언어. 렌더 경로에서 `streamDeck.i18n.language` 를 직접 읽지 않는 이유는 그 접근이
 * `streamDeck.info` 를 타고 connect 전에는 throw 하기 때문이다 — 렌더러는 순수 함수이고
 * 테스트·프리뷰가 SDK 없이 도는데, 언어를 SDK 에서 당겨오면 그 경로가 깨진다.
 * `plugin.ts` 가 connect 직후 한 번 심는다(렌더는 항상 그 뒤다).
 */
let lang: Lang = 'en';

export function setLang(next: Lang): void {
  lang = next;
}

export function currentLang(): Lang {
  return lang;
}
