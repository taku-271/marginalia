import { describe, expect, it } from "vitest";
import { clearDraft, draftKey, loadDraft, saveDraft, type DraftStorage } from "../src/client/draftStore.js";

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const broken: DraftStorage = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

describe("draftStore", () => {
  it("保存した下書きを同じセッション・種別で復元できる", () => {
    const s = memoryStorage();
    saveDraft(s, "answer", "s1", "途中の回答");
    expect(loadDraft(s, "answer", "s1")).toBe("途中の回答");
  });

  it("セッションと種別ごとに分かれる", () => {
    const s = memoryStorage();
    saveDraft(s, "answer", "s1", "A");
    saveDraft(s, "freeNote", "s1", "B");
    expect(loadDraft(s, "answer", "s2")).toBe("");
    expect(loadDraft(s, "answer", "s1")).toBe("A");
    expect(loadDraft(s, "freeNote", "s1")).toBe("B");
    expect(draftKey("answer", "s1")).not.toBe(draftKey("freeNote", "s1"));
  });

  it("送信成功後に clearDraft すると復元されない", () => {
    const s = memoryStorage();
    saveDraft(s, "answer", "s1", "送る文章");
    clearDraft(s, "answer", "s1");
    expect(loadDraft(s, "answer", "s1")).toBe("");
  });

  it("空白だけにすると下書きは消える", () => {
    const s = memoryStorage();
    saveDraft(s, "answer", "s1", "あ");
    saveDraft(s, "answer", "s1", "  \n");
    expect(s.data.size).toBe(0);
  });

  it("ストレージが無い・壊れていても例外を投げない", () => {
    expect(loadDraft(undefined, "answer", "s1")).toBe("");
    expect(() => saveDraft(undefined, "answer", "s1", "x")).not.toThrow();
    expect(() => clearDraft(undefined, "answer", "s1")).not.toThrow();
    expect(loadDraft(broken, "answer", "s1")).toBe("");
    expect(() => saveDraft(broken, "answer", "s1", "x")).not.toThrow();
    expect(() => clearDraft(broken, "answer", "s1")).not.toThrow();
  });
});
