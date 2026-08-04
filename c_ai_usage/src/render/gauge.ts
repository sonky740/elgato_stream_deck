import type { Provider, SourceState, UsageViewModel, UsageWindow } from '../usage/types';

export type Surface = 'dial' | 'key';
export type ChartType = 'donut' | 'bar';
export type Basis = 'used' | 'remaining';

export type RenderOptions = {
  surface: Surface;
  chart: ChartType;
  basis: Basis;
};

const CANVAS: Record<Surface, { w: number; h: number }> = {
  dial: { w: 200, h: 100 },
  key: { w: 144, h: 144 },
};

const BG = '#16181c';
const TRACK = '#32363e';
const TEXT = '#f4f4f5';
const MUTED = '#868d98';
const ACCENT: Record<Provider, string> = { claude: '#d97757', codex: '#10a37f' };

/** 시스템 폰트 우선. 래스터라이저가 이름을 못 찾으면 마지막 generic 으로 떨어진다. */
const FONT = "-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";

/**
 * 상태별 문구. 한 곳에 모아둔 이유는 Stream Deck 의 SVG 래스터라이저가 한글 글리프를 갖고
 * 있는지 확인되지 않았기 때문이다 — 게이트 1 에서 실패하면 이 표만 ASCII 로 바꾼다.
 */
const MESSAGE: Record<Exclude<SourceState, 'ok' | 'stale'>, string> = {
  loading: '불러오는 중',
  'no-credential': '로그인 필요',
  expired: '재로그인 필요',
  revoked: '재인증 필요',
  forbidden: '권한 부족',
  unentitled: '권한 없음',
  throttled: '일시 제한',
  blocked: '차단됨 (CF)',
  network: '연결 실패',
  'shape-changed': '형식 변경',
};

/**
 * 뷰모델 하나를 SVG 문자열로 그린다. 순수 함수다 — 픽스처만으로 전 상태를 검증할 수 있다.
 * `nowMs` 를 인자로 받는 이유가 그것이다: stale 나이 표시가 `Date.now()` 를 직접 부르면
 * 같은 입력이 호출 시점마다 다른 SVG 를 내 스냅샷도 프리뷰도 결정적이지 않게 된다.
 *
 * 캔버스 전체를 매번 다시 그린다. 그래서 슬롯이 비어도, 차트 종류가 바뀌어도 레이아웃 item 을
 * 조건부로 만들 필요가 없다(layout item 의 type/key/rect 는 런타임 변경 불가).
 *
 * 도넛 호는 `stroke-dasharray` 가 아니라 arc path(`A` 명령)로 그린다 — dasharray 보다
 * 훨씬 기본적인 기능이라 래스터라이저 호환 리스크가 낮다.
 */
export function renderGauge(vm: UsageViewModel, opts: RenderOptions, nowMs: number): string {
  const { w, h } = CANVAS[opts.surface];
  const body =
    vm.state === 'ok' || vm.state === 'stale'
      ? renderSlots(vm, opts)
      : centeredMessage(w, h, MESSAGE[vm.state], ACCENT[vm.provider]);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    opts.surface === 'key'
      ? `<rect x="0" y="0" width="${w}" height="${h}" rx="16" fill="${BG}"/>`
      : `<rect x="0" y="0" width="${w}" height="${h}" fill="${BG}"/>`,
    header(vm, opts, nowMs),
    body,
    '</svg>',
  ].join('');
}

function renderSlots(vm: UsageViewModel, opts: RenderOptions): string {
  const { fiveHour, week } = vm.slots;
  if (fiveHour === null && week === null) {
    const { w, h } = CANVAS[opts.surface];
    return centeredMessage(w, h, '데이터 없음', ACCENT[vm.provider]);
  }
  const accent = ACCENT[vm.provider];
  if (opts.chart === 'donut') {
    return opts.surface === 'dial'
      ? dialDonuts(fiveHour, week, opts.basis, accent)
      : keyDonuts(fiveHour, week, opts.basis, accent);
  }
  return opts.surface === 'dial'
    ? dialBars(fiveHour, week, opts.basis, accent)
    : keyBars(fiveHour, week, opts.basis, accent);
}

/* ── 헤더 ─────────────────────────────────────────────────────────── */

function header(vm: UsageViewModel, opts: RenderOptions, nowMs: number): string {
  const name = vm.provider === 'claude' ? 'CLAUDE' : 'CODEX';
  const note = vm.state === 'stale' && vm.fetchedAtMs !== null ? age(nowMs - vm.fetchedAtMs) : '';
  if (opts.surface === 'dial') {
    return (
      text(10, 13, name, { size: 9, fill: MUTED, weight: 600, spacing: 1.2 }) +
      (note === '' ? '' : text(190, 13, note, { size: 8, fill: MUTED, anchor: 'end' }))
    );
  }
  // 키 헤더는 y=13 이다. 도넛 바깥 링의 위쪽 끝이 y≈22 이므로 그보다 위에 둬야 겹치지 않는다.
  return (
    text(14, 13, name, { size: 9, fill: MUTED, weight: 600, spacing: 1.2 }) +
    (note === '' ? '' : text(132, 13, note, { size: 8, fill: MUTED, anchor: 'end' }))
  );
}

/* ── 다이얼 200×100 ───────────────────────────────────────────────── */

function dialDonuts(
  fiveHour: UsageWindow | null,
  week: UsageWindow | null,
  basis: Basis,
  accent: string,
): string {
  return [
    donutCell(52, 58, 25, 8, fiveHour, basis, accent, '5H', 16, 96),
    donutCell(148, 58, 25, 8, week, basis, accent, 'WK', 16, 96),
  ].join('');
}

function dialBars(
  fiveHour: UsageWindow | null,
  week: UsageWindow | null,
  basis: Basis,
  accent: string,
): string {
  // 라벨 열은 x 10..44 다. `WK Opus` 같은 스코프 라벨이 들어오므로 폭을 확보하고 폰트를 줄였다 —
  // 좁게 두면 라벨이 바 아래로 밀려 들어가 겹친다.
  const geom = { labelX: 10, labelSize: 9, barX: 52, barW: 96, valueX: 190, barH: 11 } as const;
  return [
    barRow(45, fiveHour, basis, accent, '5H', geom),
    barRow(75, week, basis, accent, 'WK', geom),
  ].join('');
}

/* ── 키 144×144 ───────────────────────────────────────────────────── */

/**
 * 동심원 2개. 다이얼 컴포지션을 그대로 축소하지 않는 이유는 200×100 과 144×144 의 종횡비가
 * 달라(2:1 vs 1:1) 나란한 배치가 정사각형을 낭비하기 때문이다. 바깥 링이 5H, 안쪽이 WK 이고
 * 중앙 판독부의 글자색이 각 링과 같아 범례 역할을 한다.
 */
function keyDonuts(
  fiveHour: UsageWindow | null,
  week: UsageWindow | null,
  basis: Basis,
  accent: string,
): string {
  const inner = `${accent}8c`;
  // 중심을 82 로 내리고 안쪽 링을 r=39/stroke 11 로 잡으면 중앙 여백 반지름이 33.5 다.
  // 판독 두 줄(베이스라인 76 · 94)이 그 원 안에 들어가므로 링을 침범하지 않는다.
  //
  // 여기서는 서버가 준 전체 라벨(`WK·Opus` 등)이 아니라 짧은 슬롯 코드만 쓴다 — 중앙 여백이
  // 폰트 12 로 9글자쯤이라 스코프명을 넣으면 안쪽 링을 넘어간다. 스코프는 다이얼에서 보여준다.
  return [
    ring(72, 82, 54, 11, value(fiveHour, basis), accent),
    ring(72, 82, 39, 11, value(week, basis), inner),
    text(72, 76, readout('5H', value(fiveHour, basis)), {
      size: 12,
      fill: accent,
      weight: 700,
      anchor: 'middle',
    }),
    text(72, 94, readout('WK', value(week, basis)), {
      size: 12,
      fill: inner,
      weight: 700,
      anchor: 'middle',
    }),
  ].join('');
}

function keyBars(
  fiveHour: UsageWindow | null,
  week: UsageWindow | null,
  basis: Basis,
  accent: string,
): string {
  const geom = { labelX: 14, labelSize: 11, barX: 14, barW: 116, valueX: 130, barH: 14 } as const;
  return [
    stackedBar(56, fiveHour, basis, accent, '5H', geom),
    stackedBar(104, week, basis, accent, 'WK', geom),
  ].join('');
}

/* ── 조각 ─────────────────────────────────────────────────────────── */

function donutCell(
  cx: number,
  cy: number,
  r: number,
  stroke: number,
  win: UsageWindow | null,
  basis: Basis,
  accent: string,
  fallbackLabel: string,
  valueSize: number,
  labelY: number,
): string {
  const v = value(win, basis);
  return [
    ring(cx, cy, r, stroke, v, accent),
    text(cx, cy + Math.round(valueSize * 0.35), pct(v), {
      size: valueSize,
      fill: v === null ? MUTED : TEXT,
      weight: 700,
      anchor: 'middle',
    }),
    text(cx, labelY, win?.label ?? fallbackLabel, { size: 10, fill: MUTED, anchor: 'middle' }),
  ].join('');
}

type BarGeom = {
  labelX: number;
  labelSize: number;
  barX: number;
  barW: number;
  valueX: number;
  barH: number;
};

function barRow(
  cy: number,
  win: UsageWindow | null,
  basis: Basis,
  accent: string,
  fallbackLabel: string,
  g: BarGeom,
): string {
  const v = value(win, basis);
  return [
    text(g.labelX, cy + 4, clampLabel(win?.label ?? fallbackLabel, g), {
      size: g.labelSize,
      fill: MUTED,
    }),
    bar(g.barX, cy - g.barH / 2, g.barW, g.barH, v, accent),
    text(g.valueX, cy + 4, pct(v), {
      size: 13,
      fill: v === null ? MUTED : TEXT,
      weight: 600,
      anchor: 'end',
    }),
  ].join('');
}

/**
 * 라벨을 라벨 열 폭에 맞춘다. 라벨은 서버가 준 스코프명(`WK Oauth apps` 등)일 수 있어 길이가
 * 미지다 — 넘치면 바 위로 흘러 겹친다. 실제 텍스트 폭을 잴 수 없으므로 폰트 크기당 평균
 * 글리프 폭으로 보수적으로 어림한다.
 */
function clampLabel(label: string, g: BarGeom): string {
  const maxChars = Math.floor((g.barX - g.labelX - 2) / (g.labelSize * 0.56));
  return label.length <= maxChars ? label : `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

function stackedBar(
  labelBaseline: number,
  win: UsageWindow | null,
  basis: Basis,
  accent: string,
  fallbackLabel: string,
  g: BarGeom,
): string {
  const v = value(win, basis);
  return [
    text(
      g.labelX,
      labelBaseline,
      clampLabel(win?.label ?? fallbackLabel, { ...g, barX: g.valueX - 34 }),
      {
        size: g.labelSize,
        fill: MUTED,
      },
    ),
    text(g.valueX, labelBaseline, pct(v), {
      size: 16,
      fill: v === null ? MUTED : TEXT,
      weight: 700,
      anchor: 'end',
    }),
    bar(g.barX, labelBaseline + 8, g.barW, g.barH, v, accent),
  ].join('');
}

/** 트랙 + 채움 링. 값이 `null`(모름)이면 트랙만 그린다 — 0% 로 그리면 안 된다. */
function ring(
  cx: number,
  cy: number,
  r: number,
  stroke: number,
  v: number | null,
  accent: string,
): string {
  const track = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>`;
  if (v === null || v <= 0) {
    return track;
  }
  const frac = Math.min(v, 100) / 100;
  const fill =
    frac >= 0.999
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="${stroke}"/>`
      : `<path d="${arcPath(cx, cy, r, frac)}" fill="none" stroke="${accent}" stroke-width="${stroke}" stroke-linecap="round"/>`;
  return track + fill;
}

function bar(x: number, y: number, w: number, h: number, v: number | null, accent: string): string {
  const radius = h / 2;
  const track = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${TRACK}"/>`;
  if (v === null || v <= 0) {
    return track;
  }
  // 값이 아주 작아도 최소 h 만큼은 그려 둥근 끝이 찌그러지지 않게 한다.
  const filled = Math.max(h, (Math.min(v, 100) / 100) * w);
  return (
    track +
    `<rect x="${x}" y="${y}" width="${round(filled)}" height="${h}" rx="${radius}" fill="${accent}"/>`
  );
}

/** 12시에서 시계방향으로 `frac` 만큼. 360°는 하나의 A 명령으로 표현할 수 없어 호출부에서 걸러낸다. */
function arcPath(cx: number, cy: number, r: number, frac: number): string {
  const start = polar(cx, cy, r, 0);
  const end = polar(cx, cy, r, frac * 360);
  const largeArc = frac > 0.5 ? 1 : 0;
  return `M ${start} A ${r} ${r} 0 ${largeArc} 1 ${end}`;
}

function polar(cx: number, cy: number, r: number, deg: number): string {
  const rad = (deg * Math.PI) / 180;
  return `${round(cx + r * Math.sin(rad))} ${round(cy - r * Math.cos(rad))}`;
}

type TextOptions = {
  size: number;
  fill: string;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  spacing?: number;
};

/**
 * `y` 는 베이스라인이다. `dominant-baseline` 을 쓰지 않는 이유는 래스터라이저별 지원이
 * 고르지 않아 세로 정렬이 조용히 어긋날 수 있기 때문이다 — 좌표로 직접 잡는다.
 */
function text(x: number, y: number, content: string, o: TextOptions): string {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-family="${FONT}"`,
    `font-size="${o.size}"`,
    `fill="${o.fill}"`,
    o.weight === undefined ? '' : `font-weight="${o.weight}"`,
    o.anchor === undefined ? '' : `text-anchor="${o.anchor}"`,
    o.spacing === undefined ? '' : `letter-spacing="${o.spacing}"`,
  ]
    .filter((a) => a !== '')
    .join(' ');
  return `<text ${attrs}>${escapeXml(content)}</text>`;
}

function centeredMessage(w: number, h: number, message: string, accent: string): string {
  return (
    `<circle cx="${w / 2}" cy="${h / 2 - 8}" r="9" fill="none" stroke="${accent}" stroke-width="3"/>` +
    text(w / 2, h / 2 + 22, message, { size: 12, fill: MUTED, anchor: 'middle' })
  );
}

/* ── 값 변환 ──────────────────────────────────────────────────────── */

/**
 * 표시할 값. `null`(모름)에는 `remaining` 변환을 적용하지 않는다 — `100 - null` 이
 * "100% 남음"이 되어, 진실이 "모름"인데 여유 만점이라고 자신 있게 표시하는 최악의 오표시가 된다.
 */
function value(win: UsageWindow | null, basis: Basis): number | null {
  if (win === null || win.utilization === null) {
    return null;
  }
  return basis === 'used' ? win.utilization : 100 - win.utilization;
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.floor(v)}%`;
}

function readout(label: string, v: number | null): string {
  return `${label} ${pct(v)}`;
}

function age(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return '방금';
  }
  return minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 전`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
