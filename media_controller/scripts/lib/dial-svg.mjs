/**
 * 터치스트립 재구성 SVG(200×100) — README·스토어 자산이 공유한다.
 *
 * ⚠ **실기기 캡처가 아니라 재구성이다.** 이 플러그인은 `setFeedback` 으로 값만 보내고 그리는 건
 * 기기의 레이아웃 렌더러다. 그래서 뽑아낼 렌더 산출물이 없고, 대신 **레이아웃 정의를 읽어** 같은
 * rect·폰트 크기·굵기·색으로 다시 그린다. 재현되지 않는 것: 기기의 폰트 패밀리와 안티에일리어싱.
 *
 * 레이아웃을 파싱하는 이유가 그것이다 — 좌표를 베껴 두면 레이아웃을 고칠 때 그림만 조용히
 * 옛것으로 남는다. 두 스크립트가 각자 재구성하면 같은 사고가 파일 단위로 생긴다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PLUGIN = path.join(import.meta.dirname, '..', '..', 'com.sonky.media-controller.sdPlugin');
const FONT = "-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** 자리표시 곡 정보. 실제 음원을 쓰면 특정 곡에 대한 캡처처럼 보인다. README·스토어가 영문이라 문구도 영문. */
export const PLACEHOLDER_TRACK = { title: 'Song title', artist: 'Artist', album: 'Album' };

const layout = JSON.parse(readFileSync(path.join(PLUGIN, 'layouts', 'now-playing.json'), 'utf8'));

const item = (key) => {
  const found = layout.items.find((i) => i.key === key);
  if (found === undefined) {
    throw new Error(
      `layout has no '${key}' item — check whether the render call site changed with it.`,
    );
  }
  return found;
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 레이아웃 text item 을 그린다. rect 안 세로 중앙에 놓는다. */
function text(key, value) {
  const { rect, font, color } = item(key);
  const [x, y, , h] = rect;
  const size = font.size;
  const baseline = y + h / 2 + size * 0.35;
  return (
    `<text x="${x}" y="${baseline.toFixed(1)}" font-family="${FONT}" font-size="${size}"` +
    ` font-weight="${font.weight}" fill="${color}">${esc(value)}</text>`
  );
}

/**
 * 앨범아트 자리. 기기에서는 플레이어가 준 커버가 들어간다 — 실제 앨범 커버를 쓰지 않으려고
 * 추상 도형으로 대신한다. rect 는 레이아웃이 정한다.
 */
function albumArt() {
  const [x, y, w, h] = item('albumArt').rect;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#2a2f3a"/>` +
    `<circle cx="${x + w * 0.5}" cy="${y + h * 0.5}" r="${w * 0.3}" fill="none" stroke="#4d566a" stroke-width="${w * 0.09}"/>` +
    `<circle cx="${x + w * 0.5}" cy="${y + h * 0.5}" r="${w * 0.07}" fill="#4d566a"/>`
  );
}

/** @param {{title: string, artist: string, album: string}} track */
export function dialSvg(track) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">` +
    albumArt() +
    text('title', track.title) +
    text('artist', track.artist) +
    text('album', track.album) +
    `</svg>`
  );
}
