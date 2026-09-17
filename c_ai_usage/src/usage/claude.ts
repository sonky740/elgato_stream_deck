import { isExpired, readClaudeCredential } from './credentials';
import { getJson } from './http';
import { readStatuslineSlots } from './claude-statusline';
import {
  assignSlots,
  EMPTY_SLOTS,
  type FetchResult,
  type LimitsSource,
  type UsageWindow,
} from './types';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

const FIVE_HOUR_SEC = 5 * 60 * 60;
const WEEK_SEC = 7 * 24 * 60 * 60;

/**
 * Claude 구독 사용량 소스. 2단 읽기다:
 * tier 1 statusline 캐시가 신선하면 네트워크 0, 아니면 tier 2 로 직접 GET.
 *
 * 어느 tier 든 수치는 서버 계산·계정 범위다. 로컬 사용량 로그(`~/.claude/projects/**`)는 읽지 않는다.
 */
export class ClaudeSource implements LimitsSource {
  readonly provider = 'claude' as const;

  async fetch(): Promise<FetchResult> {
    const now = Date.now();

    const cached = await readStatuslineSlots(now);
    if (cached !== null) {
      return { state: 'ok', slots: cached };
    }

    const cred = await readClaudeCredential();
    if (cred === null) {
      return { state: 'no-credential', slots: EMPTY_SLOTS };
    }
    // 만료 선판정 — 확실히 401 이 될 요청을 네트워크에 내보내지 않는다.
    if (isExpired(cred.expiresAtMs, now)) {
      return { state: 'expired', slots: EMPTY_SLOTS };
    }

    const res = await getJson(USAGE_URL, {
      Authorization: `Bearer ${cred.accessToken}`,
      'anthropic-beta': OAUTH_BETA,
      'Content-Type': 'application/json',
    });
    if (res.kind === 'failed') {
      return { state: res.state, slots: EMPTY_SLOTS };
    }
    return parseUsage(res.body);
  }
}

/** 창 길이를 키 이름에서 파생한다 — Claude 응답에는 길이 필드가 없다(Codex 는 있다). */
const durationOf = (key: string): number => {
  if (key === 'five_hour') {
    return FIVE_HOUR_SEC;
  }
  return key.startsWith('seven_day') ? WEEK_SEC : 0;
};

const labelOf = (key: string): string => {
  if (key === 'five_hour') {
    return '5H';
  }
  if (key === 'seven_day') {
    return 'WK';
  }
  // 공백 대신 가운뎃점을 쓴다 — 다이얼 라벨 열이 좁아 한 글자가 아깝고, 한 토큰으로 읽힌다.
  const scope = key.slice('seven_day_'.length).replace(/_/g, ' ');
  return `WK·${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
};

/** ISO 8601 문자열 → epoch ms. Codex 의 epoch 초와 혼동하면 1970년이 나온다. */
const parseIsoMs = (value: unknown): number | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

/**
 * 응답을 슬롯 2개로 정규화한다.
 *
 * 창 슬롯을 **열거하지 않고 순회**한다 — 이 계정에서만 13개가 오고(11개는 null) 코드네임 슬롯이
 * 계속 추가된다. 이름을 나열하면 새 창이 생길 때 조용히 누락된다.
 *
 * `limits[]` 배열은 v1 에서 쓰지 않는다: 같은 수치를 int 로 담아(`percent` 12 vs `utilization` 12.0)
 * 소수점 해상도를 잃고, scoped 항목의 `resets_at` 이 null 로 오는데 창 객체는 값을 갖는다.
 */
export const parseUsage = (body: unknown): FetchResult => {
  const root = asRecord(body);
  if (root === null) {
    return { state: 'shape-changed', slots: EMPTY_SLOTS };
  }

  const windows: UsageWindow[] = [];
  for (const [key, value] of Object.entries(root)) {
    const rec = asRecord(value);
    if (rec === null || !('utilization' in rec)) {
      continue;
    }
    const durationSec = durationOf(key);
    if (durationSec === 0) {
      continue;
    }
    const used = rec['utilization'];
    windows.push({
      label: labelOf(key),
      durationSec,
      utilization: typeof used === 'number' ? used : null,
      resetsAtMs: parseIsoMs(rec['resets_at']),
    });
  }

  // 창 모양 키가 하나도 없다 = 사용량 0이 아니라 미권한이다. 토큰에 user:profile scope 가 없으면
  // 서버가 빈 본문으로 단락한다 — 이걸 0% 로 렌더하면 "여유 만점"으로 정반대로 읽힌다.
  if (windows.length === 0) {
    return { state: 'unentitled', slots: EMPTY_SLOTS };
  }
  return { state: 'ok', slots: assignSlots(windows) };
};
