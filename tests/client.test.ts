import { describe, expect, it, vi } from "vitest";
import { createApiClient, sha256Hex } from "../src/client/apiClient.js";
import { createEventTracker, toLocalIso, type TrackerEnv } from "../src/client/eventTracker.js";
import { VisibleStopwatch, type StopwatchEnv } from "../src/client/visibleStopwatch.js";
import { parseClientEvent } from "../src/shared/events.js";

function fakeDoc() {
  let hidden = false;
  let t = 0;
  const listeners: Array<() => void> = [];
  const intervals: Array<() => void> = [];
  const stopwatchEnv: StopwatchEnv = {
    now: () => t,
    isHidden: () => hidden,
    onVisibilityChange: (cb) => {
      listeners.push(cb);
      return () => listeners.splice(listeners.indexOf(cb), 1);
    },
  };
  const env: TrackerEnv = {
    setInterval: (cb) => intervals.push(cb),
    isHidden: () => hidden,
    onVisibilityChange: (cb) => void listeners.push(cb),
    isStandalone: () => true,
    now: () => new Date("2026-11-05T13:14:03.120Z"),
    stopwatchEnv,
  };
  return {
    env,
    stopwatchEnv,
    advance: (ms: number) => (t += ms),
    setHidden(h: boolean) {
      hidden = h;
      [...listeners].forEach((l) => l());
    },
    tick: () => intervals.forEach((i) => i()),
  };
}

function fakeApi() {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  const api = createApiClient({ getIdToken: () => "tok", fetch: fetch as unknown as typeof globalThis.fetch });
  const bodies = () => fetch.mock.calls.map((c) => JSON.parse(String(c[1]!.body)) as { events: unknown[] });
  return { api, fetch, bodies };
}

describe("apiClient", () => {
  it("X-Id-Token と x-amz-content-sha256 を付ける", async () => {
    const { api, fetch } = fakeApi();
    await api.post("/api/events", { events: [] }, { keepalive: true });
    const init = fetch.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Id-Token"]).toBe("tok");
    expect(headers["x-amz-content-sha256"]).toBe(await sha256Hex('{"events":[]}'));
    expect(init.keepalive).toBe(true);
  });

  it("空文字の SHA-256", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("eventTracker", () => {
  it("送るイベントはサーバーのスキーマを満たす", async () => {
    const d = fakeDoc();
    const { api, bodies } = fakeApi();
    const t = createEventTracker({ api, appVersion: "0.1.0", env: d.env });
    t.start();
    t.screenView("question", { bookId: "b_1" });
    t.track("answer_submit", { questionType: "apply", answerLength: 48, secondsToAnswer: 32 }, { bookId: "b_1", sessionId: "s_1" });
    t.captureError("render", new Error("x".repeat(500)));
    await t.flush();
    const events = bodies()[0]!.events;
    expect(events).toHaveLength(4);
    for (const e of events) expect(parseClientEvent(e)).not.toBeNull();
    expect((events[2] as { screen: string }).screen).toBe("question"); // 現在の画面を引き継ぐ
  });

  it("10秒ごとに送る / 20件で送る / 25件ずつに分割", async () => {
    const d = fakeDoc();
    const { api, fetch, bodies } = fakeApi();
    const t = createEventTracker({ api, appVersion: "0.1.0", env: d.env });
    t.start(); // app_open
    d.tick();
    await t.flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 19; i++) t.track("free_note_skip", {});
    expect(fetch).toHaveBeenCalledTimes(1);
    t.track("free_note_skip", {}); // 20件目
    await t.flush();
    expect(bodies()[1]!.events).toHaveLength(20);

    fetch.mockClear();
    // 閾値での自動送信を待たずにまとめて積む
    const many = Array.from({ length: 30 });
    many.forEach(() => t.track("app_open", {}));
    await t.flush();
    const sizes = fetch.mock.calls.map((c) => (JSON.parse(String(c[1]!.body)) as { events: unknown[] }).events.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(30);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(25);
  });

  it("裏に回ったら keepalive で即送信、復帰で app_open", async () => {
    const d = fakeDoc();
    const { api, fetch, bodies } = fakeApi();
    const t = createEventTracker({ api, appVersion: "0.1.0", env: d.env });
    t.start();
    d.setHidden(true);
    await t.flush();
    expect(fetch.mock.calls[0]![1]!.keepalive).toBe(true);
    d.setHidden(false);
    expect(t.queueLength).toBe(1);
    await t.flush();
    expect((bodies().at(-1)!.events[0] as { type: string }).type).toBe("app_open");
  });

  it("送信失敗は握りつぶす", async () => {
    const d = fakeDoc();
    const fetch = vi.fn(async () => {
      throw new TypeError("network");
    });
    const api = createApiClient({ getIdToken: () => "tok", fetch: fetch as unknown as typeof globalThis.fetch });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = createEventTracker({ api, appVersion: "0.1.0", env: d.env });
    t.start();
    await expect(t.flush()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("VisibleStopwatch", () => {
  it("hidden の時間を除外する", () => {
    const d = fakeDoc();
    const sw = new VisibleStopwatch(d.stopwatchEnv);
    d.advance(10_000);
    d.setHidden(true);
    d.advance(60_000);
    d.setHidden(false);
    d.advance(5_000);
    expect(sw.stop()).toBe(15);
    d.advance(5_000);
    expect(sw.seconds).toBe(15);
  });
});

describe("toLocalIso", () => {
  it("オフセット付き ISO8601 を返し、元の時刻と一致する", () => {
    const d = new Date("2026-11-05T13:14:03.120Z");
    const s = toLocalIso(d);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(new Date(s).getTime()).toBe(d.getTime());
  });
});
