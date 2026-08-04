import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderGauge, type Basis, type ChartType, type Surface } from './gauge';
import type { Provider, SourceState, UsageViewModel, UsageWindow } from '../usage/types';

const PREVIEW_DIR = path.join(import.meta.dirname, '..', '..', 'preview');

const FIXED_NOW = Date.parse('2026-08-04T02:00:00Z');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function win(
  label: string,
  durationSec: number,
  utilization: number | null,
  resetsAtMs: number | null = null,
): UsageWindow {
  return { label, durationSec, utilization, resetsAtMs };
}

function slots(five: number | null, week: number | null): UsageViewModel['slots'] {
  return { fiveHour: win('5H', 18000, five), week: win('WK', 604800, week) };
}

/**
 * 두 슬롯의 위험도 조합. `risk()` 의 네 등급(none·ok·warn·crit)을 주역·조역 양쪽에서 밟고,
 * 임계 경계(80·95)를 양쪽 기준에서 앞뒤로 스친다.
 */
const RISK_PAIRS: readonly (readonly [number | null, number | null])[] = [
  [null, null],
  [null, 26],
  [26, null],
  [0, 3],
  [37, 26],
  [79, 80],
  [80, 79],
  [94, 95],
  [95, 94],
  [100, 100],
];

function vm(over: Partial<UsageViewModel> = {}): UsageViewModel {
  return {
    provider: 'claude',
    slots: { fiveHour: win('5H', 18000, 37), week: win('WK', 604800, 26) },
    state: 'ok',
    fetchedAtMs: FIXED_NOW,
    ...over,
  };
}

describe('renderGauge', () => {
  it('네 조합 모두 캔버스 규격에 맞는 SVG 를 낸다', () => {
    for (const surface of ['dial', 'key'] as Surface[]) {
      for (const chart of ['donut', 'bar'] as ChartType[]) {
        const svg = renderGauge(vm(), { surface, chart, basis: 'used' }, FIXED_NOW);
        const size = surface === 'dial' ? 'width="200" height="100"' : 'width="144" height="144"';
        expect(svg).toContain(size);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
      }
    }
  });

  it('stroke-dasharray 를 쓰지 않는다 — 래스터라이저 호환 리스크가 가장 큰 기능이다', () => {
    for (const surface of ['dial', 'key'] as Surface[]) {
      expect(
        renderGauge(vm(), { surface, chart: 'donut', basis: 'used' }, FIXED_NOW),
      ).not.toContain('dasharray');
    }
  });

  /**
   * 8자리 hex 를 넣었더니 안쪽 링이 안 그려지고 텍스트가 검정이 된 실기기 사고(2026-08-04)를
   * 막는다. 부정 단정(`not.toContain('…8c')`)이 아니라 **모든 색을 뽑아 형식을 단정**하는
   * 이유가 그것이다 — `rgba()`·`hsl()`·`#RGBA` 도 같은 클래스이므로 함께 막힌다.
   *
   * utilization 축이 있어야 실제 가드가 된다 — 임계색(warn·crit)과 흐린 accent 는 전부
   * `risk()` 분기 뒤에 있어서, 고정 픽스처 하나로 도는 스윕은 새 색을 한 번도 밟지 못한다.
   */
  it('모든 fill·stroke 가 #RRGGBB 아니면 none 이다', () => {
    const states: SourceState[] = [
      'ok',
      'stale',
      'loading',
      'no-credential',
      'expired',
      'revoked',
      'forbidden',
      'unentitled',
      'throttled',
      'blocked',
      'network',
      'shape-changed',
    ];
    const colors = new Set<string>();
    for (const provider of ['claude', 'codex'] as Provider[]) {
      for (const state of states) {
        for (const [five, week] of RISK_PAIRS) {
          for (const surface of ['dial', 'key'] as Surface[]) {
            for (const chart of ['donut', 'bar'] as ChartType[]) {
              for (const basis of ['used', 'remaining'] as Basis[]) {
                const svg = renderGauge(
                  vm({ provider, state, slots: slots(five, week) }),
                  { surface, chart, basis },
                  FIXED_NOW,
                );
                for (const [, color] of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
                  colors.add(color ?? '');
                }
              }
            }
          }
        }
      }
    }
    expect(colors.size).toBeGreaterThan(3);
    expect([...colors].filter((c) => c !== 'none' && !/^#[0-9a-f]{6}$/i.test(c))).toEqual([]);
  });

  /**
   * 실기기에서 그려지는 것이 확인된 요소만 쓴다. 이 래스터라이저는 지원 범위가 문서화돼
   * 있지 않고 미지원을 **조용히 무시**한다(raw SVG 문자열·8자리 hex 가 그랬다) — 새 요소를
   * 넣으면 그것 하나만 빠진 화면이 되고 로그에는 아무것도 남지 않는다.
   *
   * 늘리려면 먼저 `render/probe.ts` 로 실기기에서 확인한 뒤 여기에 추가한다.
   */
  it('실기기에서 확인된 SVG 요소만 쓴다', () => {
    const proven = new Set(['svg', 'rect', 'circle', 'path', 'text']);
    const used = new Set<string>();
    for (const state of ['ok', 'blocked'] as SourceState[]) {
      for (const [five, week] of RISK_PAIRS) {
        for (const surface of ['dial', 'key'] as Surface[]) {
          for (const chart of ['donut', 'bar'] as ChartType[]) {
            const svg = renderGauge(
              vm({ state, slots: slots(five, week) }),
              { surface, chart, basis: 'used' },
              FIXED_NOW,
            );
            for (const [, tag] of svg.matchAll(/<([a-z]+)/g)) {
              used.add(tag ?? '');
            }
          }
        }
      }
    }
    expect([...used].filter((t) => !proven.has(t))).toEqual([]);
  });

  it('dominant-baseline 을 쓰지 않는다 — 세로 정렬을 좌표로 잡는다', () => {
    expect(
      renderGauge(vm(), { surface: 'key', chart: 'donut', basis: 'used' }, FIXED_NOW),
    ).not.toContain('dominant-baseline');
  });

  // 5H 가 비었으므로 주간이 주역으로 승격된 상태다. 조역이 된 5H 가 0% 로 보이지 않아야 한다.
  it('빈 슬롯은 트랙만 그리고 값에 — 를 쓴다 (0% 아님)', () => {
    const svg = renderGauge(
      vm({ slots: { fiveHour: null, week: win('WK', 604800, 31) } }),
      {
        surface: 'dial',
        chart: 'donut',
        basis: 'used',
      },
      FIXED_NOW,
    );
    expect(svg).toContain('—');
    expect(svg).not.toContain('0%');
  });

  it('utilization null 에 remaining 을 적용하지 않는다 — 100% 남음은 정반대 오표시다', () => {
    const svg = renderGauge(
      vm({ slots: { fiveHour: win('5H', 18000, null), week: null } }),
      {
        surface: 'dial',
        chart: 'bar',
        basis: 'remaining',
      },
      FIXED_NOW,
    );
    expect(svg).not.toContain('100%');
    expect(svg).toContain('—');
  });

  it('remaining 은 100 에서 뺀 값을 쓴다', () => {
    const svg = renderGauge(vm(), { surface: 'dial', chart: 'bar', basis: 'remaining' }, FIXED_NOW);
    expect(svg).toContain('63%'); // 100 - 37
    expect(svg).toContain('74%'); // 100 - 26
  });

  it('100% 는 호가 아니라 완전한 원으로 그린다 — A 명령은 360°를 표현할 수 없다', () => {
    const svg = renderGauge(
      vm({ slots: slots(100, 100) }),
      { surface: 'dial', chart: 'donut', basis: 'used' },
      FIXED_NOW,
    );
    // 두 링이 다 꽉 찼으므로 호가 하나도 없어야 한다.
    expect(svg).not.toContain('<path');
  });

  /**
   * 5H 가 없을 때 큰 자리를 빈 구멍으로 남기면 아는 값(주간)이 작은 자리로 밀려 화면 절반이
   * 낭비된다. Codex 는 항상 이 모양이라 예외가 아니라 정상 경로다.
   */
  it('5H 를 모르고 주간만 알면 주간이 주역 자리로 올라간다', () => {
    const svg = renderGauge(
      vm({
        provider: 'codex',
        slots: { fiveHour: null, week: win('WK', 604800, 18, FIXED_NOW + 4 * DAY) },
      }),
      { surface: 'key', chart: 'bar', basis: 'used' },
      FIXED_NOW,
    );
    // 주역 숫자는 32px 자리다.
    expect(svg).toMatch(/font-size="32"[^>]*>18%/);
    expect(svg).not.toMatch(/font-size="32"[^>]*>—/);
    // 5H 는 조역 자리에 이유와 함께 남는다 — 공란이 고장으로 보이면 안 된다.
    expect(svg).toContain('주간만 제공');
  });

  it('5H 를 알면 승격하지 않는다', () => {
    const svg = renderGauge(
      vm({ slots: slots(37, 26) }),
      { surface: 'key', chart: 'bar', basis: 'used' },
      FIXED_NOW,
    );
    expect(svg).toMatch(/font-size="32"[^>]*>37%/);
  });

  /**
   * 임계는 표시값이 아니라 위험도로 판정한다. 경계(80·95)에서 한 칸 어긋나면 조용히 틀리고,
   * 남은양 기준의 뒤집기(`100 - x`)는 그 어긋남이 가장 숨기 좋은 자리다.
   */
  it('임계 경계가 두 기준에서 같은 위험을 같은 색으로 낸다', () => {
    const gradeOf = (utilization: number, basis: Basis): string => {
      const svg = renderGauge(
        vm({ slots: slots(utilization, null) }),
        { surface: 'key', chart: 'donut', basis },
        FIXED_NOW,
      );
      return svg.includes('#dc2626') ? 'crit' : svg.includes('#d97706') ? 'warn' : 'ok';
    };

    expect(gradeOf(79, 'used')).toBe('ok');
    expect(gradeOf(80, 'used')).toBe('warn');
    expect(gradeOf(94, 'used')).toBe('warn');
    expect(gradeOf(95, 'used')).toBe('crit');
    for (const utilization of [79, 80, 94, 95]) {
      expect(gradeOf(utilization, 'remaining')).toBe(gradeOf(utilization, 'used'));
    }
  });

  it('남은 시간을 5H 는 시·분, 주간은 일·시로 쓴다', () => {
    const svg = renderGauge(
      vm({
        slots: {
          fiveHour: win('5H', 18000, 37, FIXED_NOW + 2 * HOUR + 14 * MIN),
          week: win('WK', 604800, 26, FIXED_NOW + 3 * DAY + 4 * HOUR),
        },
      }),
      { surface: 'key', chart: 'donut', basis: 'used' },
      FIXED_NOW,
    );
    expect(svg).toContain('2h 14m');
    expect(svg).toContain('3d 4h');
  });

  it('이미 지난 초기화 시각을 음수로 쓰지 않는다 — 폴링 사이에 창이 초기화될 수 있다', () => {
    const svg = renderGauge(
      vm({ slots: { fiveHour: win('5H', 18000, 37, FIXED_NOW - 90_000), week: null } }),
      { surface: 'dial', chart: 'bar', basis: 'used' },
      FIXED_NOW,
    );
    expect(svg).toContain('0m');
    expect(svg).not.toMatch(/>-/);
  });

  /** "여유 있음"과 "플러그인 고장"이 닮으면 안 된다 — 실패 화면은 게이지를 아예 그리지 않는다. */
  it('실패 화면에는 게이지 기하가 없다', () => {
    const svg = renderGauge(
      vm({ state: 'blocked' }),
      { surface: 'key', chart: 'bar', basis: 'used' },
      FIXED_NOW,
    );
    expect(svg).not.toContain('<path');
    expect(svg).not.toContain('<line');
    // 배경판 1개뿐 — 세그먼트도 chip 도 없다.
    expect(svg.match(/<rect/g)).toHaveLength(1);
    // 헤더 점 + 경고 배지.
    expect(svg.match(/<circle/g)).toHaveLength(2);
  });

  it('실패 상태마다 서로 다른 문구를 낸다', () => {
    const states: Exclude<SourceState, 'ok' | 'stale'>[] = [
      'loading',
      'no-credential',
      'expired',
      'revoked',
      'forbidden',
      'unentitled',
      'throttled',
      'blocked',
      'network',
      'shape-changed',
    ];
    const rendered = states.map((state) =>
      renderGauge(vm({ state }), { surface: 'dial', chart: 'donut', basis: 'used' }, FIXED_NOW),
    );
    expect(new Set(rendered).size).toBe(states.length);
  });

  it('stale 은 게이지를 유지하고 나이를 덧붙인다', () => {
    const svg = renderGauge(
      vm({ state: 'stale', fetchedAtMs: FIXED_NOW - 8 * 60_000 }),
      { surface: 'dial', chart: 'donut', basis: 'used' },
      FIXED_NOW,
    );
    expect(svg).toContain('37%');
    expect(svg).toContain('8분 전');
  });

  it('프로바이더별로 accent 색이 다르다', () => {
    const claude = renderGauge(
      vm({ provider: 'claude' }),
      {
        surface: 'dial',
        chart: 'bar',
        basis: 'used',
      },
      FIXED_NOW,
    );
    const codex = renderGauge(
      vm({ provider: 'codex' }),
      {
        surface: 'dial',
        chart: 'bar',
        basis: 'used',
      },
      FIXED_NOW,
    );
    expect(claude).toContain('#d97757');
    expect(codex).toContain('#10a37f');
    expect(claude).toContain('CLAUDE');
    expect(codex).toContain('CODEX');
  });

  it('라벨의 XML 특수문자를 이스케이프한다 — 라벨은 서버가 주는 문자열이다', () => {
    const svg = renderGauge(
      vm({ slots: { fiveHour: win('A<B&C', 18000, 5), week: null } }),
      {
        surface: 'dial',
        chart: 'bar',
        basis: 'used',
      },
      FIXED_NOW,
    );
    expect(svg).toContain('A&lt;B&amp;C');
    expect(svg).not.toContain('A<B&C');
  });

  it('두 슬롯이 다 비면 데이터 없음을 그린다', () => {
    const svg = renderGauge(
      vm({ slots: { fiveHour: null, week: null } }),
      {
        surface: 'dial',
        chart: 'donut',
        basis: 'used',
      },
      FIXED_NOW,
    );
    expect(svg).toContain('데이터 없음');
  });
});

/**
 * 프리뷰 생성. 200x100 · 144x144 에서 실제로 읽히는지는 눈으로만 확인할 수 있으므로
 * 모든 조합을 실제 픽셀 크기로 타일링한 컨택트시트를 만든다(ai-limits-plan.md §6).
 * 이건 검증이 아니라 검증 도구다 — 단정하지 않는다.
 *
 * ⚠ **레이아웃 판정에만 쓴다.** 컨택트시트를 그리는 브라우저는 Stream Deck 래스터라이저의
 * 상위집합이라 기능 지원 문제는 여기서 드러나지 않는다(8자리 hex 가 그랬다). 그쪽은 위의
 * 색 형식 불변식이 막는다.
 */
describe('preview', () => {
  it('컨택트시트를 생성한다', () => {
    type Case = { name: string; vm: UsageViewModel };
    /** 남은 시간이 실제로 그려지는지 보려면 픽스처에 초기화 시각이 있어야 한다. */
    const five = (v: number | null, leftMs: number | null, label = '5H'): UsageWindow =>
      win(label, 18000, v, leftMs === null ? null : FIXED_NOW + leftMs);
    const week = (v: number | null, leftMs: number | null, label = 'WK'): UsageWindow =>
      win(label, 604800, v, leftMs === null ? null : FIXED_NOW + leftMs);
    const cases: Case[] = [
      {
        name: 'ok-low',
        vm: vm({
          slots: { fiveHour: five(3, 4 * HOUR + 41 * MIN), week: week(12, 5 * DAY + 6 * HOUR) },
        }),
      },
      {
        name: 'ok-both',
        vm: vm({
          slots: { fiveHour: five(37, 2 * HOUR + 14 * MIN), week: week(26, 3 * DAY + 4 * HOUR) },
        }),
      },
      {
        name: 'warn',
        vm: vm({
          slots: { fiveHour: five(84, 47 * MIN), week: week(62, 2 * DAY + 11 * HOUR) },
        }),
      },
      {
        name: 'crit',
        vm: vm({
          slots: {
            fiveHour: five(97, 68 * MIN),
            week: week(100, 6 * DAY + 2 * HOUR, 'WK·Opus'),
          },
        }),
      },
      {
        name: 'codex-5h-empty',
        vm: vm({
          provider: 'codex',
          slots: { fiveHour: null, week: week(18, 4 * DAY + 9 * HOUR) },
        }),
      },
      {
        name: 'unknown-value',
        vm: vm({ slots: { fiveHour: five(null, null), week: week(26, 3 * DAY + 4 * HOUR) } }),
      },
      {
        name: 'long-label',
        vm: vm({
          slots: {
            fiveHour: five(41, 2 * HOUR, '5H Oauth apps'),
            week: week(58, 4 * DAY, 'WK Oauth apps'),
          },
        }),
      },
      {
        name: 'stale',
        vm: vm({
          state: 'stale',
          fetchedAtMs: FIXED_NOW - 23 * MIN,
          slots: { fiveHour: five(37, 2 * HOUR + 14 * MIN), week: week(26, 3 * DAY + 4 * HOUR) },
        }),
      },
      { name: 'loading', vm: vm({ state: 'loading', slots: { fiveHour: null, week: null } }) },
      {
        name: 'no-credential',
        vm: vm({ state: 'no-credential', slots: { fiveHour: null, week: null } }),
      },
      {
        name: 'blocked',
        vm: vm({ provider: 'codex', state: 'blocked', slots: { fiveHour: null, week: null } }),
      },
    ];

    // 픽스처 이름이 바뀌면 옛 SVG 가 남아 컨택트시트에 섞인다 — 매번 비우고 새로 만든다.
    rmSync(PREVIEW_DIR, { recursive: true, force: true });
    mkdirSync(PREVIEW_DIR, { recursive: true });
    const rows: string[] = [];
    for (const surface of ['dial', 'key'] as Surface[]) {
      for (const chart of ['donut', 'bar'] as ChartType[]) {
        for (const basis of ['used', 'remaining'] as Basis[]) {
          const cells = cases.map((c) => {
            const svg = renderGauge(c.vm, { surface, chart, basis }, FIXED_NOW);
            writeFileSync(
              path.join(PREVIEW_DIR, `${surface}-${chart}-${basis}-${c.name}.svg`),
              svg,
            );
            return `<figure><figcaption>${c.name}</figcaption>${svg}</figure>`;
          });
          rows.push(
            `<section><h2>${surface} / ${chart} / ${basis}</h2><div class="row">${cells.join('')}</div></section>`,
          );
        }
      }
    }
    writeFileSync(
      path.join(PREVIEW_DIR, 'index.html'),
      `<!doctype html><meta charset="utf-8"><style>
body{background:#0b0c0e;color:#c9ced6;font:12px -apple-system,sans-serif;margin:12px}
h2{font-size:11px;color:#6f7783;margin:14px 0 6px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.row{display:flex;gap:10px;flex-wrap:wrap}
figure{margin:0}
figcaption{font-size:9px;color:#5d646e;margin-bottom:3px}
svg{display:block;outline:1px solid #23262b}
</style>${rows.join('')}`,
    );
    expect(true).toBe(true);
  });
});
