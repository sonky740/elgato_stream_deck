/**
 * 플러그인 마크(270° 트윈 아크)와 색 — 아이콘 세트와 스토어 앱 아이콘이 공유한다.
 *
 * 두 겹이 두 창(5H·주간)을 뜻하고 아래쪽 90° 를 비워 게이지 하단 판독부와 같은 실루엣을 갖는다.
 * 기하를 쓰는 쪽이 둘이므로 여기가 소유자다 — 복사하면 한쪽 자산만 조용히 옛 디자인으로 남는다.
 */
export const BG = '#16181c';
export const MUTED = '#868d98';
export const TEXT = '#f4f4f5';
export const ACCENT = { claude: '#d97757', codex: '#10a37f' };

/**
 * 조역 아크의 흐린 accent. 여기서는 **8자리 hex(알파)를 써도 된다** — 이 SVG 는 Chrome 이
 * 오프라인에서 PNG 로 굽고, 기기에 올라가는 건 PNG 다. 실기기 래스터라이저가 8자리 hex 를
 * 못 읽는 제약은 `src/render/gauge.ts` 쪽(런타임 SVG)에만 적용된다 — 여기를 6자리로
 * "고치면" 투명 배경 자산에서 배경과 섞을 수 없어 오히려 어긋난다.
 */
export const dim = (provider) => `${ACCENT[provider]}8c`;

/**
 * 액션 목록·카테고리 아이콘용. Marketplace 가이드라인이 그 두 자리에 **`#FFFFFF` 단색 + 투명 배경**을
 * 요구하고 색이 있으면 심사에서 반려된다 — 브랜드색으로 두 프로바이더를 구분하던 것을 포기한 자리다.
 */
export const MONO = '#ffffff';
export const MONO_DIM = `${MONO}8c`;

/**
 * 크기대별 기하 비율. **논리 크기**로 분기한다 — 1x/2x 는 같은 논리 크기를 다른 해상도로
 * 그리는 것이므로 같은 분기를 타야 디자인이 일치한다(40px 자산에 40px 분기를 쓰면
 * icon@2x 가 icon 과 다른 그림이 된다).
 *
 * 작아질수록 스트로크를 줄이고 두 아크를 벌린다 — 그대로 축소하면 간격이 1~2px 로 떨어져
 * 두 겹이 한 덩어리로 보이고, 두 겹이 두 창을 뜻한다는 의미가 사라진다.
 */
export const geom = (logical) => {
  if (logical <= 24) {
    return { cy: 0.53, r1: 0.36, r2: 0.15, w: 0.11 };
  }
  if (logical <= 72) {
    return { cy: 0.52, r1: 0.35, r2: 0.16, w: 0.115 };
  }
  return { cy: 150 / 288, r1: 94 / 288, r2: 56 / 288, w: 24 / 288 };
};

const r1 = (n) => Math.round(n * 100) / 100;

/** 12시에서 시계방향. 270° 는 한 A 명령으로 그려진다(largeArc=1). */
export const arc = (cx, cy, r, fromDeg, toDeg, stroke, width) => {
  const at = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${r1(cx + r * Math.sin(rad))} ${r1(cy - r * Math.cos(rad))}`;
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `<path d="M ${at(fromDeg)} A ${r1(r)} ${r1(r)} 0 ${large} 1 ${at(toDeg)}" fill="none" stroke="${stroke}" stroke-width="${r1(width)}" stroke-linecap="round"/>`;
};

export const svgDoc = (px, parts) => {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${parts.filter(Boolean).join('')}</svg>`;
};

export const mark = ({ logical, scale, outer, inner, plate }) => {
  const px = logical * scale;
  const g = geom(logical);
  return svgDoc(px, [
    plate
      ? `<rect x="0" y="0" width="${px}" height="${px}" rx="${r1(px * 0.1875)}" fill="${BG}"/>`
      : '',
    arc(px / 2, px * g.cy, px * g.r1, -135, 135, outer, px * g.w),
    arc(px / 2, px * g.cy, px * g.r2, -135, 135, inner, px * g.w),
  ]);
};
