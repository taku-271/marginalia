import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app.js";
import type { Llm } from "../src/server/ai/bedrock.js";
import type { ReadingNote, ReadingSession } from "../src/server/db/model.js";
import type { Repo } from "../src/server/db/repo.js";
import type { AppConfig } from "../src/server/config.js";

function setup(llmText: string, answered = true) {
  const notes: ReadingNote[] = [];
  const session: ReadingSession = {
    bookId: "b1",
    sessionId: "s1",
    startedAt: "2026-11-01T00:00:00.000Z",
    endedAt: "2026-11-01T00:30:00.000Z",
    durationMinutes: 30,
    ...(answered ? { question: "Q", answer: "A" } : {}),
  };
  const repo = {
    getBook: async () => ({ bookId: "b1", title: "本", createdAt: "2026-11-01T00:00:00.000Z" }),
    markBookFinished: async () => {},
    listSessions: async () => [session],
    putNote: async (_u: string, n: ReadingNote) => void notes.push(n),
    putItem: async () => {},
    batchPut: async () => {},
  } as unknown as Repo;
  const llm: Llm = vi.fn(async () => ({
    text: llmText,
    modelId: "m",
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
  }));
  const config = { prompts: { P3: { modelId: "m", maxTokens: 100 } } } as unknown as AppConfig;
  const app = createApp({ repo, llm, config, now: () => new Date("2026-11-02T00:00:00.000Z") });
  return { app, notes };
}

describe("読書ノート生成時の tryAction 保存", () => {
  it("「試してみること」節を tryAction として保存する", async () => {
    const { app, notes } = setup("## 学んだこと\nあ\n\n## 試してみること\n結論から話す\n");
    await app.finishBook("u1", "b1");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.tryAction).toBe("結論から話す");
  });

  it("試してみることが無いノートでは tryAction を持たない", async () => {
    const { app, notes } = setup("## 学んだこと\nあ\n");
    await app.finishBook("u1", "b1");
    expect(notes[0]).not.toHaveProperty("tryAction");
  });

  it("回答が無く材料不足のときはノートを保存しない", async () => {
    const { app, notes } = setup("## 試してみること\nx", false);
    await app.finishBook("u1", "b1");
    expect(notes).toHaveLength(0);
  });
});
