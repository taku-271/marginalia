import { describe, expect, it } from "vitest";
import { summarizeBooks } from "../src/server/bookSummary.js";
import type { Book, ReadingSession } from "../src/server/db/model.js";

const book = (bookId: string): Book => ({ bookId, title: bookId, createdAt: "2026-11-01T00:00:00Z" });
const session = (bookId: string, sessionId: string, startedAt: string, rest: Partial<ReadingSession> = {}): ReadingSession => ({
  bookId,
  sessionId,
  startedAt,
  ...rest,
});

describe("summarizeBooks", () => {
  it("読書履歴のない本は 0 回で、日付も未回答もない", () => {
    expect(summarizeBooks([book("a")], [])).toEqual([{ ...book("a"), sessionCount: 0 }]);
  });

  it("終了したセッションを数え、最後の終了時刻を lastReadAt にする", () => {
    const [s] = summarizeBooks(
      [book("a")],
      [
        session("a", "1", "2026-11-02T10:00:00Z", { endedAt: "2026-11-02T10:30:00Z", answer: "x" }),
        session("a", "2", "2026-11-03T10:00:00Z", { endedAt: "2026-11-03T10:20:00Z", skipped: true }),
        session("a", "3", "2026-11-04T10:00:00Z"),
      ],
    );
    expect(s!.sessionCount).toBe(2);
    expect(s!.lastReadAt).toBe("2026-11-04T10:00:00Z");
    expect(s!.pendingSessionId).toBeUndefined();
  });

  it("問いが出て未回答・未スキップの最新セッションを pendingSessionId にする", () => {
    const [s] = summarizeBooks(
      [book("a")],
      [
        session("a", "1", "2026-11-02T10:00:00Z", { endedAt: "2026-11-02T10:30:00Z", question: "q1" }),
        session("a", "2", "2026-11-03T10:00:00Z", { endedAt: "2026-11-03T10:30:00Z", question: "q2" }),
        session("a", "3", "2026-11-04T10:00:00Z", { endedAt: "2026-11-04T10:30:00Z", question: "q3", answer: "a" }),
      ],
    );
    expect(s!.pendingSessionId).toBe("2");
  });

  it("他の本のセッションは混ざらない", () => {
    const [a, b] = summarizeBooks(
      [book("a"), book("b")],
      [session("b", "1", "2026-11-02T10:00:00Z", { endedAt: "2026-11-02T10:30:00Z", question: "q" })],
    );
    expect(a!.sessionCount).toBe(0);
    expect(b!.sessionCount).toBe(1);
    expect(b!.pendingSessionId).toBe("1");
  });
});
