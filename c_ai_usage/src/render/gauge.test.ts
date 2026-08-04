import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { renderGauge, type Basis, type ChartType, type Surface } from './gauge';
import type { SourceState, UsageViewModel, UsageWindow } from '../usage/types';

const PREVIEW_DIR = path.join(import.meta.dirname, '..', '..', 'preview');

const FIXED_NOW = Date.parse('2026-08-04T02:00:00Z');

function win(label: string, durationSec: number, utilization: number | null): UsageWindow {
  return { label, durationSec, utilization, resetsAtMs: null };
}

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

  it('dominant-baseline 을 쓰지 않는다 — 세로 정렬을 좌표로 잡는다', () => {
    expect(
      renderGauge(vm(), { surface: 'key', chart: 'donut', basis: 'used' }, FIXED_NOW),
    ).not.toContain('dominant-baseline');
  });

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
      vm({ slots: { fiveHour: win('5H', 18000, 100), week: null } }),
      {
        surface: 'dial',
        chart: 'donut',
        basis: 'used',
      },
      FIXED_NOW,
    );
    // 트랙 원 + 채움 원, 그리고 5H 자리에 path 가 없다.
    expect(svg.match(/<circle/g)?.length).toBeGreaterThanOrEqual(3);
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
 */
describe('preview', () => {
  it('컨택트시트를 생성한다', () => {
    type Case = { name: string; vm: UsageViewModel };
    const cases: Case[] = [
      { name: 'ok-both', vm: vm() },
      {
        name: 'ok-high',
        vm: vm({ slots: { fiveHour: win('5H', 18000, 92), week: win('WK·Opus', 604800, 100) } }),
      },
      {
        name: 'ok-low',
        vm: vm({ slots: { fiveHour: win('5H', 18000, 3), week: win('WK', 604800, 0) } }),
      },
      {
        name: 'codex-5h-empty',
        vm: vm({ provider: 'codex', slots: { fiveHour: null, week: win('WK', 604800, 18) } }),
      },
      {
        name: 'unknown-value',
        vm: vm({ slots: { fiveHour: win('5H', 18000, null), week: win('WK', 604800, 26) } }),
      },
      { name: 'stale', vm: vm({ state: 'stale', fetchedAtMs: FIXED_NOW - 23 * 60_000 }) },
      {
        name: 'no-credential',
        vm: vm({ state: 'no-credential', slots: { fiveHour: null, week: null } }),
      },
      {
        name: 'blocked',
        vm: vm({ provider: 'codex', state: 'blocked', slots: { fiveHour: null, week: null } }),
      },
    ];

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
