import { isExpired, readCodexCredential } from './credentials';
import { getJson } from './http';
import {
  assignSlots,
  EMPTY_SLOTS,
  type FetchResult,
  type LimitsSource,
  type UsageWindow,
} from './types';

/**
 * first-party 경로다 — openai/codex 의 Rust 백엔드 클라이언트가 이 URL 을 호출한다
 * (`PathStyle::ChatGptApi => format!("{}/wham/usage", base_url)`).
 * ⚠ `/backend-api/api/codex/usage` 는 404 다. `/wham/` 세그먼트가 맞다.
 */
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

/**
 * Codex 구독 사용량 소스.
 *
 * Claude 와 두 가지가 근본적으로 다르다:
 * 1. 창 길이가 응답에 실려 온다(`limit_window_seconds`) — Claude 는 키 이름으로 추론해야 한다.
 * 2. 2026-07-13 이후 창을 **1개(주간)만** 반환한다. 5HR 슬롯은 공란이 정상이고, OpenAI 가
 *    창을 되살리면 길이 버킷팅이 코드 변경 없이 채운다(SPEC "슬롯은 2개 고정, 채울 데이터가 없으면 공란").
 */
export class CodexSource implements LimitsSource {
  readonly provider = 'codex' as const;

  async fetch(): Promise<FetchResult> {
    const cred = await readCodexCredential();
    if (cred === null) {
      return { state: 'no-credential', slots: EMPTY_SLOTS };
    }
    // 만료 선판정. auth.json 에 만료 필드가 없어 JWT `exp` 를 디코드한 값을 쓴다.
    if (isExpired(cred.expiresAtMs, Date.now())) {
      return { state: 'expired', slots: EMPTY_SLOTS };
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${cred.accessToken}` };
    if (cred.accountId !== null) {
      headers['ChatGPT-Account-Id'] = cred.accountId;
    }
    // getJson 이 자기 UA 를 붙이고 content-type 을 파싱 전에 검사한다 — chatgpt.com 은
    // Cloudflare 봇 게이트가 있어 기본 UA 면 403 + HTML 챌린지가 오고, 그걸 JSON 으로 파싱하면
    // 인증 실패와 구분할 수 없는 엉뚱한 에러가 된다.
    const res = await getJson(USAGE_URL, headers);
    if (res.kind === 'failed') {
      return { state: res.state, slots: EMPTY_SLOTS };
    }
    return parseUsage(res.body);
  }
}

/** 창 길이에서 라벨을 만든다. 버킷 경계 밖의 길이도 사람이 읽을 수 있게 포맷한다. */
const labelOf = (durationSec: number): string => {
  const hours = durationSec / 3600;
  if (hours <= 24) {
    return `${Math.round(hours)}H`;
  }
  const days = Math.round(hours / 24);
  return days === 7 ? 'WK' : `${days}D`;
};

const epochSecToMs = (value: unknown): number | null => {
  const sec = Number(value);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const toWindow = (raw: unknown): UsageWindow | null => {
  const rec = asRecord(raw);
  if (rec === null) {
    return null;
  }
  const durationSec = Number(rec['limit_window_seconds']);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return null;
  }
  const used = rec['used_percent'];
  return {
    label: labelOf(durationSec),
    durationSec,
    utilization: typeof used === 'number' ? used : null,
    // `reset_at` 은 epoch **초**다. 함께 오는 `reset_after_seconds` 는 호출마다 감소하는
    // 상대값이라 쓰지 않는다.
    resetsAtMs: epochSecToMs(rec['reset_at']),
  };
};

/**
 * 응답을 슬롯 2개로 정규화한다.
 *
 * **슬롯 위치로 라벨을 붙이지 않는다.** `primary_window` 는 2026-03~07 에 5시간 창, 07-13
 * 부터 주간 창을 담았다 — 같은 계정에서 뒤집혔다. 라벨과 슬롯 배정은 `limit_window_seconds`
 * 에서만 파생한다.
 *
 * ⚠ 응답 본문에는 `email`·`user_id`·`account_id` 가 평문으로 들어 있다. 여기서 필요한 필드만
 * 꺼내고 본문을 그대로 들고 나가지 않는 것이 PII 차단 지점이다 — 뷰모델에는 숫자만 남는다.
 */
export const parseUsage = (body: unknown): FetchResult => {
  const rateLimit = asRecord(asRecord(body)?.['rate_limit']);
  if (rateLimit === null) {
    return { state: 'shape-changed', slots: EMPTY_SLOTS };
  }

  const windows: UsageWindow[] = [];
  for (const key of ['primary_window', 'secondary_window']) {
    const win = toWindow(rateLimit[key]);
    if (win !== null) {
      windows.push(win);
    }
  }
  // 두 창이 다 null 이면 rate_limit 은 왔는데 창 정보가 없는 것이다. 0% 가 아니라 미지다.
  if (windows.length === 0) {
    return { state: 'unentitled', slots: EMPTY_SLOTS };
  }
  return { state: 'ok', slots: assignSlots(windows) };
};
