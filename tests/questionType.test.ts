import { describe, expect, it } from "vitest";
import { decideQuestionType, type PastSession } from "../src/server/ai/questionType.js";

const long = "あ".repeat(40);
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

describe("decideQuestionType", () => {
  it("1回目は insight", () => {
    expect(decideQuestionType([], () => 0.99)).toBe("insight");
  });

  it("3回連続スキップなら insight(followup 条件より優先)", () => {
    const prev: PastSession[] = [
      { questionType: "apply", skipped: true },
      { questionType: "doubt", skipped: true },
      { questionType: "experience", skipped: true, freeNote: long },
    ];
    expect(decideQuestionType(prev, () => 0)).toBe("insight");
  });

  it("前回の回答が40字以上なら 50% で followup", () => {
    const prev: PastSession[] = [{ questionType: "insight", answer: long }];
    expect(decideQuestionType(prev, () => 0.49)).toBe("followup");
    expect(decideQuestionType(prev, seq(0.5, 0))).not.toBe("followup");
  });

  it("前回の自由入力が40字以上でも followup 対象", () => {
    const prev: PastSession[] = [{ questionType: "insight", answer: "短い", freeNote: long }];
    expect(decideQuestionType(prev, () => 0)).toBe("followup");
  });

  it("39字では followup にならない(サロゲートペアは1字)", () => {
    const prev: PastSession[] = [{ questionType: "insight", answer: "𠮷".repeat(39) }];
    expect(decideQuestionType(prev, () => 0)).not.toBe("followup");
  });

  it("直近2回で使ったタイプは選ばない", () => {
    const prev: PastSession[] = [
      { questionType: "insight", answer: "x" },
      { questionType: "apply", answer: "x" },
      { questionType: "doubt", answer: "x" },
    ];
    for (let r = 0; r < 1; r += 0.05) {
      const t = decideQuestionType(prev, () => r);
      expect(["apply", "doubt", "followup"]).not.toContain(t);
    }
  });

  it("action は3セッションに1回まで", () => {
    // 2回目: floor(2/3)=0 → action 不可
    const second: PastSession[] = [{ questionType: "insight", answer: "x" }];
    for (let r = 0; r < 1; r += 0.05) expect(decideQuestionType(second, () => r)).not.toBe("action");

    // 3回目: 1回まで可
    const third: PastSession[] = [
      { questionType: "insight", answer: "x" },
      { questionType: "apply", answer: "x" },
    ];
    const seen = new Set<string>();
    for (let r = 0; r < 1; r += 0.05) seen.add(decideQuestionType(third, () => r));
    expect(seen.has("action")).toBe(true);

    // 5回目で既に1回使っている: floor(5/3)=1 → 不可
    const fifth: PastSession[] = [
      { questionType: "insight", answer: "x" },
      { questionType: "action", answer: "x" },
      { questionType: "doubt", answer: "x" },
      { questionType: "experience", answer: "x" },
    ];
    for (let r = 0; r < 1; r += 0.05) expect(decideQuestionType(fifth, () => r)).not.toBe("action");
  });
});
