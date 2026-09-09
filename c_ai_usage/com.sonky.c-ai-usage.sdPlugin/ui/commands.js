// 루트 ESLint 는 Node 글로벌만 안다(설정은 config-protection 훅 대상이라 파일 하나 때문에 열지
// 않는다) — 이 파일은 PI 웹뷰에서 돌므로 쓰는 글로벌을 여기서 선언한다.
/* global SDPIComponents, document */

/**
 * PI → 플러그인 단발 명령. 두 PI(claude·codex)가 이 배관을 공유한다.
 *
 * `sdpi-button` 은 값만 갖는 평범한 `<button>` 이라 클릭을 스스로 전송하지 않으므로 여기서
 * 보낸다. `sdpi-delegate` 는 전송을 하지만 설정값 표시칸이 딸려 와 명령용 버튼이 아니다.
 *
 * `data-send` 값은 플러그인의 `REFRESH_COMMAND` 와 같아야 한다 — 한쪽만 바꾸면 버튼이 조용히
 * 아무 일도 하지 않는다. 라벨은 `ui/i18n.js` 의 `data-i18n` 워커가 채운다(`__MSG_` 는 `label`
 * 속성과 `<option>` 에만 닿고 슬롯 텍스트에는 닿지 않는다).
 */
document.addEventListener('DOMContentLoaded', () => {
  for (const el of document.querySelectorAll('[data-send]')) {
    el.addEventListener('click', () => {
      SDPIComponents.streamDeckClient.send('sendToPlugin', { event: el.dataset.send });
    });
  }
});
