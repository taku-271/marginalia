import { describe, expect, it } from "vitest";
import { createApp, HttpError } from "../src/server/app.js";
import type { ReadingSession } from "../src/server/db/model.js";
import type { Repo } from "../src/server/db/repo.js";

function setup(session: ReadingSession | undefined) {
  const state = { session };
  const repo = {
    findSession: async () => (state.session ? { session: state.session } : undefined),
    updateSession: async (_u: string, s: ReadingSession, patch: Partial<ReadingSession>) => {
      state.session = { ...s, ...patch };
    },
  } as unknown as Repo;
  let t = 0;
  const app = createApp({
    repo,
    llm: {} as never,
    config: {} as never,
    now: () => new Date(Date.UTC(2026, 10, 6, 0, 0, t++)),
  });
  return { app, state };
}

const base: ReadingSession = { bookId: "b_1", sessionId: "s_1", startedAt: "2026-11-06T00:00:00.000Z" };

describe("addMemo(読書中のメモ)", () => {
  it("複数件を古い順に追記し、他の属性を壊さない", async () => {
    const { app, state } = setup({ ...base });
    await app.addMemo("u", "b_1", "s_1", { text: " 一つ目 " });
    const r = await app.addMemo("u", "b_1", "s_1", { text: "二つ目" });
    expect(r.memos.map((m) => m.text)).toEqual(["一つ目", "二つ目"]);
    expect(state.session?.memos).toHaveLength(2);
    expect(state.session?.endedAt).toBeUndefined();
  });

  it("空文字や文字列以外は 400", async () => {
    const { app } = setup({ ...base });
    await expect(app.addMemo("u", "b_1", "s_1", { text: "  " })).rejects.toMatchObject({ status: 400 });
    await expect(app.addMemo("u", "b_1", "s_1", {})).rejects.toBeInstanceOf(HttpError);
  });

  it("セッションがなければ 404", async () => {
    const { app } = setup(undefined);
    await expect(app.addMemo("u", "b_1", "s_x", { text: "a" })).rejects.toMatchObject({ status: 404 });
  });
});
