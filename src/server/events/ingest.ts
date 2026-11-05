import { ulid } from "ulid";
import {
  AI_CALL_PROPS,
  MAX_EVENTS_PER_REQUEST,
  parseClientEvent,
  type AiCallProps,
  type ClientEvent,
} from "../../shared/events.js";
import { keys } from "../db/model.js";
import type { Repo } from "../db/repo.js";

/** SK の並び順を揃えるため、タイムゾーン付きの ISO8601 を UTC に正規化する */
export function toUtcIso(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

export interface IngestResult {
  accepted: number;
  dropped: number;
}

/**
 * POST /api/events の本体。
 * - 先頭25件だけを対象にし、超えた分は破棄
 * - 1件ずつ検証して不正なもの(未知の type・想定外の props キーなど)は破棄
 * - 同一 eventId の重複は除く(BatchWriteItem は同一キーの重複を拒否するため)
 * - userId は呼び出し側で JWT から取り出したものだけを使う
 */
export async function ingestEvents(
  repo: Repo,
  userId: string,
  rawEvents: unknown[],
  now: Date = new Date(),
): Promise<IngestResult> {
  const head = rawEvents.slice(0, MAX_EVENTS_PER_REQUEST);
  const receivedAt = now.toISOString();
  const seen = new Set<string>();
  const valid: ClientEvent[] = [];
  for (const raw of head) {
    const e = parseClientEvent(raw);
    if (!e || seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    valid.push(e);
  }
  const items = valid.map((e) => ({
    PK: keys.pk(userId),
    SK: keys.event(toUtcIso(e.timestamp), e.eventId),
    ...e,
    receivedAt,
  }));
  await repo.batchPut(items);
  return { accepted: items.length, dropped: rawEvents.length - items.length };
}

export interface ServerEventContext {
  userId: string;
  bookId?: string;
  sessionId?: string;
}

/**
 * サーバー起点の ai_call イベントを記録する。記録の失敗で本処理を止めない。
 */
export async function recordAiCall(
  repo: Repo,
  ctx: ServerEventContext,
  props: AiCallProps,
  now: Date = new Date(),
): Promise<void> {
  try {
    const parsed = AI_CALL_PROPS.parse(props);
    const eventId = ulid(now.getTime());
    const ts = now.toISOString();
    await repo.putItem({
      PK: keys.pk(ctx.userId),
      SK: keys.event(ts, eventId),
      eventId,
      type: "ai_call",
      timestamp: ts,
      receivedAt: ts,
      bookId: ctx.bookId,
      sessionId: ctx.sessionId,
      props: parsed,
    });
  } catch (err) {
    console.error("recordAiCall failed", err);
  }
}
