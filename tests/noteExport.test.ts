import { describe, expect, it } from "vitest";
import { buildNoteExport, readingPeriod } from "../src/client/noteExport.js";

describe("buildNoteExport", () => {
  it("タイトル・著者・読書期間を先頭に付ける", () => {
    const text = buildNoteExport({ title: "本A", author: "著者", from: "2026-11-01", to: "2026-11-05", markdown: "## 本文\n- a\n" });
    expect(text).toBe("# 本A\n\n- 著者: 著者\n- 読書期間: 2026-11-01 〜 2026-11-05\n\n## 本文\n- a\n");
  });
  it("著者・期間がなければ省き、同日なら1日だけ表示", () => {
    expect(buildNoteExport({ title: "本B", markdown: "x" })).toBe("# 本B\n\nx\n");
    expect(buildNoteExport({ title: "本B", from: "2026-11-01", to: "2026-11-01", markdown: "x" })).toContain("- 読書期間: 2026-11-01\n");
  });
});

describe("readingPeriod", () => {
  const id = (iso: string) => iso.slice(0, 10);
  it("セッションがなければ空", () => {
    expect(readingPeriod([], undefined, id)).toEqual({});
  });
  it("最初の開始〜最後の終了/読了日", () => {
    const sessions = [
      { startedAt: "2026-11-03T10:00:00Z", endedAt: "2026-11-03T10:30:00Z" },
      { startedAt: "2026-11-01T10:00:00Z", endedAt: "2026-11-01T10:20:00Z" },
    ];
    expect(readingPeriod(sessions, undefined, id)).toEqual({ from: "2026-11-01", to: "2026-11-03" });
    expect(readingPeriod(sessions, "2026-11-05T00:00:00Z", id)).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });
});
