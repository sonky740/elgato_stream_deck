import type { SourceState } from './types';

/** 매니페스트 Version 과 함께 올린다. 자기 UA 를 쓴다 — CLI UA 흉내내기는 게이트 2 에서 이득 0으로 확인됐다. */
export const USER_AGENT = 'c-ai-usage/0.1.0';

/** 응답 대기 상한. 폴링 간격(300s)보다 훨씬 짧아 다음 tick 과 겹치지 않는다. */
const TIMEOUT_MS = 10_000;

export type JsonResponse =
  { kind: 'json'; body: unknown } | { kind: 'failed'; state: SourceState; status: number | null };

const looksLikeHtml = (res: Response, text: string): boolean => {
  const type = res.headers.get('content-type') ?? '';
  return type.includes('text/html') || text.trimStart().startsWith('<');
};

const statusToState = (status: number, body: string): SourceState => {
  if (status === 401) {
    return 'expired';
  }
  if (status === 403) {
    return body.includes('revoked') ? 'revoked' : 'forbidden';
  }
  if (status === 429) {
    return 'throttled';
  }
  return 'network';
};

/**
 * JSON GET 1회. 실패를 throw 하지 않고 {@link SourceState} 로 되돌린다.
 *
 * `content-type` 을 파싱 **전에** 검사한다: chatgpt.com 은 Cloudflare 봇 게이트에 걸리면
 * status 403 에 HTML 챌린지 본문을 준다. 그걸 JSON.parse 하면 인증 실패와 구분할 수 없는
 * 엉뚱한 메시지로 throw 되어, 진단 불가능한 일반 에러로 렌더된다(ai-limits-plan.md §4.2).
 */
export const getJson = async (
  url: string,
  headers: Record<string, string>,
): Promise<JsonResponse> => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { ...headers, 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'failed', state: 'network', status: null };
  }

  const text = await res.text().catch(() => '');
  if (looksLikeHtml(res, text)) {
    return { kind: 'failed', state: 'blocked', status: res.status };
  }
  if (!res.ok) {
    return { kind: 'failed', state: statusToState(res.status, text), status: res.status };
  }
  try {
    return { kind: 'json', body: JSON.parse(text) };
  } catch {
    return { kind: 'failed', state: 'shape-changed', status: res.status };
  }
};
