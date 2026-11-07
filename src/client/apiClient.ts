/**
 * すべての API 呼び出しで使う共通クライアント。
 * - X-Id-Token: Cognito の ID トークン(Authorization は CloudFront OAC の SigV4 用に空けておく)
 * - x-amz-content-sha256: ボディの SHA-256(hex)。OAC 経由で Lambda 関数URL に POST するときに必要
 */

export interface ApiClientOptions {
  baseUrl?: string;
  getIdToken: () => Promise<string | null> | string | null;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** ページが閉じられても送信を続ける(イベント送信用)。ボディは64KBまで */
  keepalive?: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl ?? "";
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function request<T = unknown>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const text = body === undefined ? "" : JSON.stringify(body);
    const token = await opts.getIdToken();
    const headers: Record<string, string> = {
      "x-amz-content-sha256": await sha256Hex(text),
    };
    if (token) headers["X-Id-Token"] = token;
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await doFetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : text,
      keepalive: options.keepalive,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    request,
    get: <T>(path: string) => request<T>("GET", path),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>("POST", path, body ?? {}, options),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
