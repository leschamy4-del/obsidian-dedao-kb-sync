export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBearerToken(token: string): string {
  const trimmed = token.trim();
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

export function parseJsonPreservingIds(text: string): unknown {
  let safe = text.replace(
    /"(id|note_id|prime_id|parent_id|follow_id|live_id|topic_id|post_id|post_id_alias)"\s*:\s*(\d+)/g,
    '"$1":"$2"'
  );
  safe = safe.replace(/"children_ids"\s*:\s*\[([^\]]*)\]/g, (_match, body: string) => {
    const normalized = body
      .split(',')
      .map(item => {
        const trimmed = item.trim();
        return /^\d{15,}$/.test(trimmed) ? `"${trimmed}"` : item;
      })
      .join(',');
    return `"children_ids":[${normalized}]`;
  });
  return JSON.parse(safe);
}

export function parseJsonObjectOrEmpty(text: string): Record<string, unknown> {
  try {
    const value = parseJsonPreservingIds(text || '{}');
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * 429 限流退避：指数退避（3s / 6s / 12s，封顶 12s）。
 * - attempt 从 1 开始，每次重试翻倍；
 * - 若服务端响应头带 Retry-After，则优先按其秒数等待（封顶 30s）。
 */
export async function waitForRetryDelay(attempt = 1, retryAfterSeconds?: number, signal?: AbortSignal): Promise<void> {
  const base = Math.min(3000 * Math.pow(2, attempt - 1), 12_000);
  const delayMs =
    retryAfterSeconds && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 30_000)
      : base;
  await new Promise<void>(resolve => {
    const timer = window.setTimeout(() => resolve(), delayMs);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
