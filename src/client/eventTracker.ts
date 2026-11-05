import { ulid } from "ulid";
import type { ClientEventProps, ClientEventType, Screen } from "../shared/events.js";
import { MAX_EVENTS_PER_REQUEST } from "../shared/limits.js";
import type { ApiClient } from "./apiClient.js";
import { VisibleStopwatch, type StopwatchEnv } from "./visibleStopwatch.js";

/**
 * イベントトラッカー。
 * - メモリ上のキューに積み、10秒ごと / 20件たまったら / 画面が裏に回ったら POST /api/events
 * - sendBeacon は独自ヘッダーを付けられないので使わず、fetch の keepalive を使う
 * - 送信失敗でアプリを止めない(console に出して捨てる)
 */

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_THRESHOLD = 20;
const MAX_QUEUE = 200;
const MAX_ERROR_MESSAGE = 200;

export interface TrackContext {
  bookId?: string;
  sessionId?: string;
  screen?: Screen;
}

interface QueuedEvent extends TrackContext {
  eventId: string;
  type: ClientEventType;
  timestamp: string;
  props: Record<string, unknown>;
  client: { appVersion: string; standalone: boolean };
}

export interface TrackerEnv {
  setInterval: (cb: () => void, ms: number) => unknown;
  isHidden: () => boolean;
  onVisibilityChange: (cb: () => void) => void;
  /** ページを離れるとき(リロード・遷移・閉じる)。visibilitychange が来ない環境の取りこぼし対策 */
  onPageHide?: (cb: () => void) => void;
  isStandalone: () => boolean;
  now: () => Date;
  stopwatchEnv?: StopwatchEnv;
  /** ページ離脱時に未送信イベントを退避する先(同期的に書ける必要がある) */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

const PENDING_KEY = "marginalia.pendingEvents";

export const browserTrackerEnv = (): TrackerEnv => ({
  setInterval: (cb, ms) => window.setInterval(cb, ms),
  isHidden: () => document.visibilityState === "hidden",
  onVisibilityChange: (cb) => document.addEventListener("visibilitychange", cb),
  onPageHide: (cb) => window.addEventListener("pagehide", cb),
  isStandalone: () =>
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true,
  now: () => new Date(),
  storage: safeLocalStorage(),
});

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** タイムゾーンオフセット付きの ISO8601(例 2026-11-05T22:14:03.120+09:00) */
export function toLocalIso(d: Date): string {
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
  );
}

export function createEventTracker(opts: {
  api: ApiClient;
  appVersion: string;
  env?: TrackerEnv;
}) {
  const env = opts.env ?? browserTrackerEnv();
  let queue: QueuedEvent[] = [];
  /** 送信を始めたがまだ終わっていないバッチ(離脱時の退避対象に含める) */
  const inflight = new Set<QueuedEvent[]>();
  let flushing: Promise<void> | null = null;
  let currentScreen: Screen | undefined;
  let wasHidden = env.isHidden();
  let started = false;

  function track<T extends ClientEventType>(type: T, props: ClientEventProps<T>, ctx: TrackContext = {}) {
    try {
      queue.push({
        eventId: ulid(),
        type,
        timestamp: toLocalIso(env.now()),
        ...(ctx.bookId ? { bookId: ctx.bookId } : {}),
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        ...((ctx.screen ?? currentScreen) ? { screen: ctx.screen ?? currentScreen } : {}),
        props: props as Record<string, unknown>,
        client: { appVersion: opts.appVersion, standalone: env.isStandalone() },
      });
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      if (queue.length >= FLUSH_THRESHOLD) void flush();
    } catch (err) {
      console.warn("track failed", err);
    }
  }

  async function sendAll(keepalive: boolean) {
    const hadPending = queue.length > 0;
    while (queue.length > 0) {
      const batch = queue.slice(0, MAX_EVENTS_PER_REQUEST);
      queue = queue.slice(batch.length);
      inflight.add(batch);
      try {
        await opts.api.post("/api/events", { events: batch }, { keepalive });
      } catch (err) {
        console.warn("event flush failed; dropping batch", err);
      } finally {
        inflight.delete(batch);
      }
    }
    if (hadPending && inflight.size === 0 && queue.length === 0) {
      try {
        env.storage?.removeItem(PENDING_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  /** キューを送る。送信中に呼ばれたら、その完了後に残りを送る */
  function flush(keepalive = false): Promise<void> {
    const run = async () => {
      if (flushing) await flushing.catch(() => undefined);
      await sendAll(keepalive);
    };
    const p = run().finally(() => {
      if (flushing === p) flushing = null;
    });
    flushing = p;
    return p;
  }

  /**
   * ページ離脱時の退避。離脱の瞬間はトークン取得などの非同期処理が終わらず fetch が始まらないことがあるため、
   * 未送信分を同期的に保存し、次回起動時に送る。二重送信になっても同じ PK/SK への上書きなので害はない。
   */
  function persistPending() {
    try {
      const pending = [...[...inflight].flat(), ...queue];
      if (pending.length > 0) env.storage?.setItem(PENDING_KEY, JSON.stringify(pending.slice(-MAX_QUEUE)));
    } catch {
      /* 保存できなくても続行 */
    }
  }

  function restorePending() {
    try {
      const raw = env.storage?.getItem(PENDING_KEY);
      env.storage?.removeItem(PENDING_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as QueuedEvent[];
      if (Array.isArray(saved)) queue = [...saved, ...queue].slice(-MAX_QUEUE);
    } catch {
      /* 壊れていたら捨てる */
    }
  }

  /** アプリ起動時に1回呼ぶ。app_open を記録し、定期送信と可視状態の監視を始める */
  function start() {
    if (started) return;
    started = true;
    restorePending();
    track("app_open", {});
    env.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    env.onVisibilityChange(() => {
      if (env.isHidden()) {
        wasHidden = true;
        persistPending();
        void flush(true);
      } else if (wasHidden) {
        wasHidden = false;
        track("app_open", {}); // バックグラウンドからの復帰
      }
    });
    env.onPageHide?.(() => {
      persistPending();
      void flush(true);
    });
  }

  function screenView(screen: Screen, ctx: Omit<TrackContext, "screen"> = {}) {
    currentScreen = screen;
    track("screen_view", { screen }, { ...ctx, screen });
  }

  /** 例外を client_error として記録(message は200字で切る) */
  function captureError(where: string, err: unknown) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_MESSAGE);
    track("client_error", { where: where.slice(0, 100), message });
  }

  /** 可視時間だけを数えるストップウォッチ(secondsToAnswer / secondsViewed 用) */
  function stopwatch() {
    return new VisibleStopwatch(env.stopwatchEnv);
  }

  return {
    start,
    track,
    flush,
    screenView,
    captureError,
    stopwatch,
    /** テスト用 */
    get queueLength() {
      return queue.length;
    },
  };
}

export type EventTracker = ReturnType<typeof createEventTracker>;
