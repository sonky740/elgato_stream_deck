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

const TRACK = '#32363e';
const TEXT = '#f4f4f5';
const MUTED = '#868d98';
const DIM = '#6b7280';
const RULE = '#23262b';
/** 조역 판독값. 주역(TEXT)보다 한 단 낮은 밝기로 위계를 만든다. */
const SUB = '#c9ced6';
const ACCENT: Record<Provider, string> = { claude: '#d97757', codex: '#10a37f' };
const WARN = '#d97706';
const WARN_TEXT = '#fcd34d';
const CRIT = '#dc2626';
const CRIT_TEXT = '#fca5a5';

/**
 * 조역 게이지용 흐린 accent. accent 를 `#16181c` 위에 54.9% 로 섞어 **미리 계산해 둔
 * 6자리 hex** 다. 이 캔버스는 배경을 칠하지 않으므로 `#16181c` 는 **가정**이다 — 밝은 프로필
 * 배경에서는 이 색과 {@link RULE}·{@link TEXT} 가 전부 배경에 묻힌다.
 *
 * ⚠ 여기에 8자리 hex(`#RRGGBBAA`)를 쓰면 안 된다 — 실기기에서 그려지지 않는다(2026-08-04).
 * 색이 적용되지 않아 링은 채움이 사라지고 텍스트는 검정이 되어 배경에 묻힌다. 전송 오류도
 * 경고도 없이 조용히 그렇게 된다.
 *
 * 이만큼 어두워도 되는 이유: 조역이 위험해지면 {@link softColor} 가 solid WARN·CRIT 로
 * 올려버린다. 흐린 색은 "지금 볼 필요 없는 창"에만 쓰이고, 판독 숫자는 {@link SUB} 가 따로 쓴다.
 */
const ACCENT_DIM: Record<Provider, string> = { claude: '#814c3c', codex: '#136452' };

/**
 * 사용량 기준 임계. 남은양 기준에서는 `100 - x` 로 뒤집힌다 — 사용 80% 와 남은 20% 는
 * 같은 상황이라 같은 색이어야 하므로 값이 아니라 위험도로 판정한다.
 */
const WARN_AT = 80;
const CRIT_AT = 95;

/** 세그먼트 미터 칸 수. 10칸이면 켜진 칸 수가 그대로 "몇 십 퍼센트"로 읽힌다. */
const SEG_COUNT = 10;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 시스템 폰트 우선. 래스터라이저가 이름을 못 찾으면 마지막 generic 으로 떨어진다. */
const FONT = "-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** 자격증명을 만드는 쪽. `{cli}` 치환에 쓴다 — "어디서 로그인하냐"가 유일한 행동 지침이다. */
const CLI: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex CLI' };

type Notice = { title: string; hint: string };

/**
 * 게이지 대신 띄우는 화면의 문구. 상태마다 제목이 다르고 한 줄로 다음 할 일을 말한다.
 *
 * 이때 게이지를 **아예 그리지 않는다** — "여유 있음"과 "플러그인 고장"이 닮으면 사용자가
 * 분간할 수 없다(계획서 §8).
 */
const NOTICE: Record<Exclude<SourceState, 'ok' | 'stale'>, Notice> = {
  loading: { title: '불러오는 중', hint: '첫 응답을 기다려요' },
  'no-credential': { title: '로그인 필요', hint: '{cli} 에서 로그인' },
  expired: { title: '재로그인 필요', hint: '토큰이 만료됐어요' },
  revoked: { title: '재인증 필요', hint: '토큰이 무효화됐어요' },
  forbidden: { title: '권한 부족', hint: 'user:profile scope 필요' },
  unentitled: { title: '권한 없음', hint: '빈 응답 · scope 확인' },
  throttled: { title: '일시 제한', hint: '요청이 많아요 · 곧 재시도' },
  blocked: { title: '차단됨', hint: 'Cloudflare 챌린지' },
  network: { title: '연결 실패', hint: '네트워크를 확인해요' },
  'shape-changed': { title: '형식 변경', hint: '응답 구조가 달라졌어요' },
};

const NO_DATA: Notice = { title: '데이터 없음', hint: '표시할 창이 없어요' };

/** 화면상 자리 하나. 슬롯이 승격돼도 자리의 기하는 그대로다. */
type Slot = {
  /** 짧은 코드. 서버 라벨이 안 들어가는 좁은 자리에서 대신 쓴다. */
  code: string;
  label: string;
  /** 기준(basis)이 적용된 표시값. `null` 은 모름. */
  v: number | null;
  /** 초기화까지 남은 ms. `null` 은 모름. */
  leftMs: number | null;
  /** 값이 없는 이유를 아는 경우의 한 줄. 없으면 `null`. */
  note: string | null;
};

type Ctx = { basis: Basis; provider: Provider };

/**
 * 뷰모델 하나를 SVG 문자열로 그린다. 순수 함수다 — 픽스처만으로 전 상태를 검증할 수 있다.
 * `nowMs` 를 인자로 받는 이유가 그것이다: stale 나이와 남은 시간이 `Date.now()` 를 직접
 * 부르면 같은 입력이 호출 시점마다 다른 SVG 를 내 스냅샷도 프리뷰도 결정적이지 않게 된다.
 *
 * 캔버스 전체를 매번 다시 그린다. 그래서 슬롯이 비어도, 차트 종류가 바뀌어도 레이아웃 item 을
 * 조건부로 만들 필요가 없다(layout item 의 type/key/rect 는 런타임 변경 불가).
 *
 * 도넛 호는 `stroke-dasharray` 가 아니라 arc path(`A` 명령)로 그린다 — dasharray 보다
 * 훨씬 기본적인 기능이라 래스터라이저 호환 리스크가 낮다.
 *
 * ⚠ **캔버스를 칠하지 않는다** — 스트림덱 프로필 배경이 그대로 비친다. 대신 어두운 배경이
 * 코드 밖의 **가정**이 됐다({@link ACCENT_DIM} 참고).
 *
 * ⚠ 남은 시간은 렌더 시점 기준으로 굳는다. 다시 그리는 계기는 폴링뿐이므로 표시된
 * 카운트다운은 최대 폴링 간격만큼 낡을 수 있다(SPEC §19).
 */
export function renderGauge(vm: UsageViewModel, opts: RenderOptions, nowMs: number): string {
  const { w, h } = CANVAS[opts.surface];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    header(vm, opts, nowMs),
    body(vm, opts, nowMs),
    '</svg>',
  ].join('');
}

function body(vm: UsageViewModel, opts: RenderOptions, nowMs: number): string {
  if (vm.state !== 'ok' && vm.state !== 'stale') {
    // loading 은 실패가 아니다 — 같은 판을 쓰되 accent 경고 배지를 달지 않는다.
    return notice(
      opts.surface,
      NOTICE[vm.state],
      vm.provider,
      vm.state === 'loading' ? 'calm' : 'alert',
    );
  }
  if (vm.slots.fiveHour === null && vm.slots.week === null) {
    return notice(opts.surface, NO_DATA, vm.provider, 'calm');
  }
  const [primary, secondary] = lead(vm, opts.basis, nowMs);
  const ctx: Ctx = { basis: opts.basis, provider: vm.provider };
  if (opts.chart === 'donut') {
    return opts.surface === 'dial'
      ? dialDonut(primary, secondary, ctx)
      : keyDonut(primary, secondary, ctx);
  }
  return opts.surface === 'dial'
    ? dialBar(primary, secondary, ctx)
    : keyBar(primary, secondary, ctx);
}

/**
 * 두 슬롯을 주역·조역으로 배치한다. 5H 를 모르고 주간만 알면 **주간을 주역 자리로 올린다** —
 * Codex 는 항상 이 모양이라(2026-07-13 이후 주간만 반환) 큰 자리를 빈 구멍으로 남기면
 * 아는 값을 작은 자리에 밀어 넣고 화면의 절반을 낭비한다.
 */
function lead(vm: UsageViewModel, basis: Basis, nowMs: number): [Slot, Slot] {
  const five = slotOf('5H', vm.slots.fiveHour, basis, nowMs, fiveHourNote(vm));
  const week = slotOf('WK', vm.slots.week, basis, nowMs, null);
  return five.v === null && week.v !== null ? [week, five] : [five, week];
}

/** Codex 의 5H 공란은 고장이 아니라 벤더 계약이다(SPEC §Purpose) — 그렇다고 알려준다. */
function fiveHourNote(vm: UsageViewModel): string | null {
  return vm.provider === 'codex' && vm.slots.fiveHour === null ? '주간만 제공' : null;
}

function slotOf(
  code: string,
  win: UsageWindow | null,
  basis: Basis,
  nowMs: number,
  note: string | null,
): Slot {
  const resets = win?.resetsAtMs ?? null;
  return {
    code,
    label: win?.label ?? code,
    v: value(win, basis),
    leftMs: resets === null ? null : resets - nowMs,
    note,
  };
}

/* ── 헤더 ─────────────────────────────────────────────────────────── */

function header(vm: UsageViewModel, opts: RenderOptions, nowMs: number): string {
  const g = opts.surface === 'dial' ? { x: 10, y: 14, endX: 190 } : { x: 12, y: 15, endX: 132 };
  const name = vm.provider === 'claude' ? 'CLAUDE' : 'CODEX';
  const note = vm.state === 'stale' && vm.fetchedAtMs !== null ? age(nowMs - vm.fetchedAtMs) : '';
  return [
    // 프로바이더 점. 두 액션을 나란히 올렸을 때 이름을 읽기 전에 어느 쪽인지 알게 한다.
    `<circle cx="${g.x + 3}" cy="${g.y - 3.5}" r="3" fill="${ACCENT[vm.provider]}"/>`,
    text(g.x + 11, g.y, name, { size: 9, fill: MUTED, weight: 600, spacing: 1.1 }),
    note === '' ? '' : text(g.endX, g.y, note, { size: 8, fill: DIM, anchor: 'end' }),
  ].join('');
}

/* ── 도넛 (디자인 1b) ─────────────────────────────────────────────── */

/**
 * 헤어라인 링 + 대형 숫자. 링을 5px 로 얇게 밀어내고 반지름을 50/40 으로 당겨, 중앙 글자
 * 상자가 네 귀퉁이까지 안쪽 링에서 떨어지는 크기(27px, 4자리는 21px)로 세운다.
 *
 * 조역은 링 아래 빈 줄을 통째로 쓴다 — 없앤 chip 자리다. chip 은 배경색으로 링을 가려
 * 성립했으므로 캔버스를 칠하지 않는 지금은 투명 배경 위의 검은 상자가 된다.
 */
function keyDonut(p: Slot, s: Slot, c: Ctx): string {
  const big = pct(p.v);
  return [
    ring(72, 70, 50, 5, p.v, gaugeColor(p.v, c)),
    ring(72, 70, 40, 5, s.v, softColor(s.v, c)),
    // 링 안쪽에서 가장 좁은 지점은 베이스라인이 아니라 글자 상자 위쪽이라 예산이 42px(6글자)
    // 뿐이다. 서버 스코프명을 넣으면 `5H Oa…` 같은 무의미한 잘림이 되므로 keyBar 조역 행과
    // 같이 짧은 코드를 쓴다 — 스코프명은 다이얼에서 보여준다.
    text(72, 46, p.code, { size: 10, fill: MUTED, anchor: 'middle', spacing: 0.6 }),
    text(72, 78, big, {
      size: big.length >= 4 ? 21 : 27,
      fill: numColor(p.v, c),
      weight: 700,
      anchor: 'middle',
    }),
    // y=94 는 13px 이 링 안에 들어가는 가장 아래다 — 더 내리면 원이 좁아져 7글자가 링에 닿는다.
    text(72, 94, fmt(p.leftMs), { size: 13, fill: MUTED, anchor: 'middle' }),
    text(14, 138, s.code, { size: 10, fill: MUTED, spacing: 0.6 }),
    s.v === null
      ? text(130, 138, s.note ?? '—', {
          size: 11,
          fill: subColor(s.v, c),
          weight: 600,
          anchor: 'end',
        })
      : text(40, 139, pct(s.v), { size: 15, fill: subColor(s.v, c), weight: 700 }) +
        text(130, 138, fmt(s.leftMs), { size: 11, fill: DIM, anchor: 'end' }),
  ].join('');
}

/**
 * 폭이 남는 다이얼에서는 두 창을 같은 크기 셀로 나란히 둔다 — 주간을 작은 링에 몰아넣던
 * 위계가 "주간이 안 보인다"의 원인이었다.
 *
 * 셀 크기가 같으므로 승격은 **자리 이동이 아니라 강조의 이동**이다(디자인 원안은 강조까지
 * 5H 에 고정한다 — 그러면 Codex 는 유일하게 아는 값이 흐린 색으로 그려진다). 자리를 고정하는
 * 이유는 5H 가 폴링 사이에 사라지면 두 셀이 맞바뀌어 눈이 매번 다시 찾아야 하기 때문이다.
 */
function dialDonut(p: Slot, s: Slot, c: Ctx): string {
  const [left, right] = p.code === '5H' ? [p, s] : [s, p];
  return donutCell(52, left, left === p, c) + donutCell(148, right, right === p, c);
}

function donutCell(cx: number, w: Slot, primary: boolean, c: Ctx): string {
  const big = pct(w.v);
  return [
    ring(cx, 48, 26, 5, w.v, primary ? gaugeColor(w.v, c) : softColor(w.v, c)),
    text(cx, 54, big, {
      size: big.length >= 4 ? 12 : 16,
      fill: primary ? numColor(w.v, c) : subColor(w.v, c),
      weight: 700,
      anchor: 'middle',
    }),
    text(cx, 86, clampLabel(w.label, 84, 9, 0.6), {
      size: 9,
      fill: MUTED,
      anchor: 'middle',
      spacing: 0.6,
    }),
    text(cx, 98, w.v === null && w.note !== null ? w.note : fmt(w.leftMs), {
      size: 11,
      fill: DIM,
      anchor: 'middle',
    }),
  ].join('');
}

/* ── 세그먼트 미터 (디자인 1d) ────────────────────────────────────── */

/**
 * 주역 32px / 조역 19px 로 위계를 확실히 둔다. 연속 바를 10칸으로 끊은 이유는
 * {@link segments} 에 있다.
 */
function keyBar(p: Slot, s: Slot, c: Ctx): string {
  return [
    // 12px 로 커진 남은 시간이 x=78 까지 밀려온다 — 라벨 예산이 그만큼 줄었다.
    text(14, 36, clampLabel(p.label, 60, 10, 0.6), {
      size: 10,
      fill: MUTED,
      weight: 600,
      spacing: 0.6,
    }),
    text(130, 36, fmt(p.leftMs), { size: 12, fill: DIM, anchor: 'end' }),
    text(14, 72, pct(p.v), { size: 32, fill: numColor(p.v, c), weight: 700 }),
    segments(14, 80, 116, 10, p.v, gaugeColor(p.v, c)),
    // 1px 채움 rect 다. `<line>` 이 더 자연스럽지만 이 래스터라이저에서 확인된 적이 없다 —
    // 여기서 미확인 요소가 조용히 안 그려지면 구분선 하나가 사라지고 아무 신호도 없다.
    `<rect x="14" y="99.5" width="116" height="1" fill="${RULE}"/>`,
    // 조역 행은 좁아 서버 라벨이 아니라 짧은 코드를 쓴다. 스코프명은 다이얼에서 보여준다.
    text(14, 118, s.code, { size: 10, fill: MUTED, weight: 600, spacing: 0.6 }),
    text(130, 118, s.v === null && s.note !== null ? s.note : fmt(s.leftMs), {
      size: 12,
      fill: DIM,
      anchor: 'end',
    }),
    text(14, 135, pct(s.v), { size: 19, fill: subColor(s.v, c), weight: 700 }),
    // 미터 시작점은 `100%` 폭(19px 에서 ≈49px)이 결정한다 — 64 에 두면 네 자리에서 숫자에 붙는다.
    segments(68, 128, 62, 8, s.v, softColor(s.v, c)),
  ].join('');
}

function dialBar(p: Slot, s: Slot, c: Ctx): string {
  const note = s.v === null ? s.note : null;
  return [
    text(10, 39, clampLabel(p.label, 48, 10, 0.6), {
      size: 10,
      fill: MUTED,
      weight: 600,
      spacing: 0.6,
    }),
    text(10, 54, fmt(p.leftMs), { size: 11, fill: DIM }),
    segments(62, 34, 66, 15, p.v, gaugeColor(p.v, c)),
    text(190, 49, pct(p.v), { size: 21, fill: numColor(p.v, c), weight: 700, anchor: 'end' }),
    text(10, 76, clampLabel(s.label, 48, 10, 0.6), {
      size: 10,
      fill: MUTED,
      weight: 600,
      spacing: 0.6,
    }),
    // 노트만 9px 로 남긴다 — 문장이라 11px 로 키우면 x=62 의 세그먼트 미터 아래로 흘러든다.
    text(10, 91, note ?? fmt(s.leftMs), { size: note === null ? 11 : 9, fill: DIM }),
    segments(62, 72, 66, 10, s.v, softColor(s.v, c)),
    text(190, 87, pct(s.v), { size: 17, fill: subColor(s.v, c), weight: 700, anchor: 'end' }),
  ].join('');
}

/* ── 게이지 대신 뜨는 화면 ────────────────────────────────────────── */

function notice(surface: Surface, n: Notice, provider: Provider, tone: 'alert' | 'calm'): string {
  const color = tone === 'alert' ? ACCENT[provider] : MUTED;
  const hint = n.hint.replace('{cli}', CLI[provider]);
  const g =
    surface === 'key'
      ? { cx: 72, cy: 56, r: 15, glyph: 20, titleY: 96, hintY: 114, hintSize: 10 }
      : { cx: 100, cy: 42, r: 13, glyph: 18, titleY: 76, hintY: 92, hintSize: 9 };
  return [
    `<circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="${color}" stroke-width="3"/>`,
    tone === 'alert'
      ? text(g.cx, g.cy + Math.round(g.glyph * 0.35), '!', {
          size: g.glyph,
          fill: color,
          weight: 700,
          anchor: 'middle',
        })
      : '',
    text(g.cx, g.titleY, n.title, { size: 14, fill: TEXT, weight: 700, anchor: 'middle' }),
    text(g.cx, g.hintY, hint, { size: g.hintSize, fill: DIM, anchor: 'middle' }),
  ].join('');
}

/* ── 색 ───────────────────────────────────────────────────────────── */

type Risk = 'none' | 'ok' | 'warn' | 'crit';

/** 표시값이 아니라 **위험**으로 판정한다 — 그래서 남은양 기준에서 임계가 뒤집힌다. */
function risk(v: number | null, basis: Basis): Risk {
  if (v === null) {
    return 'none';
  }
  if (basis === 'used') {
    return v >= CRIT_AT ? 'crit' : v >= WARN_AT ? 'warn' : 'ok';
  }
  return v <= 100 - CRIT_AT ? 'crit' : v <= 100 - WARN_AT ? 'warn' : 'ok';
}

function gaugeColor(v: number | null, c: Ctx): string {
  const k = risk(v, c.basis);
  return k === 'crit' ? CRIT : k === 'warn' ? WARN : ACCENT[c.provider];
}

/** 조역 게이지. 위험해지면 주역과 같은 강도로 올라온다 — 흐린 건 안전할 때만이다. */
function softColor(v: number | null, c: Ctx): string {
  const k = risk(v, c.basis);
  return k === 'crit' ? CRIT : k === 'warn' ? WARN : ACCENT_DIM[c.provider];
}

function numColor(v: number | null, c: Ctx): string {
  const k = risk(v, c.basis);
  return k === 'none' ? MUTED : k === 'crit' ? CRIT_TEXT : k === 'warn' ? WARN_TEXT : TEXT;
}

function subColor(v: number | null, c: Ctx): string {
  const k = risk(v, c.basis);
  return k === 'none' ? MUTED : k === 'crit' ? CRIT_TEXT : k === 'warn' ? WARN_TEXT : SUB;
}

/* ── 조각 ─────────────────────────────────────────────────────────── */

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

/**
 * 10칸 세그먼트 미터. 칸 수는 거리에서 길이보다 빨리 세어지고, 몇 칸이 켜졌는지가 그대로
 * "몇 십 퍼센트"로 읽힌다. 0 보다 큰 값은 최소 1칸을 켠다 — 3% 가 빈 미터로 보이면 안 된다.
 */
function segments(
  x: number,
  y: number,
  w: number,
  h: number,
  v: number | null,
  accent: string,
): string {
  const gap = Math.max(2, w * 0.024);
  const bw = (w - gap * (SEG_COUNT - 1)) / SEG_COUNT;
  const lit =
    v === null || v <= 0 ? 0 : Math.max(1, Math.round((Math.min(v, 100) / 100) * SEG_COUNT));
  return Array.from(
    { length: SEG_COUNT },
    (_, i) =>
      `<rect x="${round(x + i * (bw + gap))}" y="${y}" width="${round(bw)}" height="${h}" rx="2" fill="${i < lit ? accent : TRACK}"/>`,
  ).join('');
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

/**
 * 라벨을 주어진 픽셀 폭에 맞춘다. 라벨은 서버가 준 스코프명(`WK Oauth apps` 등)일 수 있어
 * 길이가 미지다 — 넘치면 옆 요소 위로 흘러 겹친다. 실제 글리프 폭을 잴 수 없으므로 폰트
 * 크기당 평균 폭으로 보수적으로 어림한다.
 *
 * `spacing` 을 빼먹으면 안 된다 — 글자당 그만큼씩 늘어나 8글자에서 5px 가 새고, 그 5px 가
 * 라벨을 옆 게이지 위로 밀어 넣는다(다이얼 바에서 실제로 그랬다).
 */
function clampLabel(label: string, maxPx: number, size: number, spacing = 0): string {
  const maxChars = Math.floor(maxPx / (size * 0.62 + spacing));
  return label.length <= maxChars ? label : `${label.slice(0, Math.max(1, maxChars - 1))}…`;
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

/**
 * 초기화까지 남은 시간. 0 에서 자른다 — 폴링 사이에 창이 초기화되면 값이 음수가 되고
 * floor/modulo 사슬이 `-1m` 을 내놓는다.
 */
function fmt(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  const left = Math.max(0, ms);
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / HOUR);
  const m = Math.floor((left % HOUR) / MIN);
  if (d > 0) {
    return `${d}d ${h}h`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function age(ms: number): string {
  const minutes = Math.floor(ms / MIN);
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
