import { describe, expect, it, vi } from "vitest";
import { createApp, HttpError } from "../src/server/app.js";
import type { Repo } from "../src/server/db/repo.js";
import type { Book } from "../src/server/db/model.js";

// 本の編集に必要な部分だけのインメモリ fake(ユーザーごとに本を分ける)
function fakeRepo(initial: Record<string, Book>) {
  const books = new Map(Object.entries(initial)); // key: `${userId}/${bookId}`
  const repo = {
    getBook: async (u: string, b: string) => books.get(`${u}/${b}`),
    updateBookInfo: vi.fn(async (u: string, b: string, title: string, author: string | undefined) => {
      const cur = books.get(`${u}/${b}`)!;
      books.set(`${u}/${b}`, { ...cur, title, author });
    }),
  };
  return { repo, books };
}

const base: Book = { bookId: "b1", title: "ほん", author: "著者", createdAt: "2026-01-01T00:00:00.000Z" };

function setup() {
  const f = fakeRepo({ "u1/b1": base });
  const app = createApp({ repo: f.repo as unknown as Repo, llm: {} as never, config: {} as never });
  return { app, ...f };
}

describe("app.updateBook", () => {
  it("タイトルと著者を更新して返す(前後の空白は除く)", async () => {
    const { app, books } = setup();
    const r = await app.updateBook("u1", "b1", { title: "  新しい題 ", author: " 新著者 " });
    expect(r).toMatchObject({ bookId: "b1", title: "新しい題", author: "新著者", createdAt: base.createdAt });
    expect(books.get("u1/b1")).toMatchObject({ title: "新しい題", author: "新著者" });
  });

  it("author が空・未指定なら著者を外す", async () => {
    const { app, repo } = setup();
    expect((await app.updateBook("u1", "b1", { title: "題", author: "" })).author).toBeUndefined();
    expect(repo.updateBookInfo).toHaveBeenLastCalledWith("u1", "b1", "題", undefined);
    await app.updateBook("u1", "b1", { title: "題" });
    expect(repo.updateBookInfo).toHaveBeenLastCalledWith("u1", "b1", "題", undefined);
  });

  it("タイトルが空・文字列でない・長すぎる場合は 400 で何も書かない", async () => {
    const { app, repo } = setup();
    for (const title of ["", "   ", 1, undefined, "あ".repeat(5000)]) {
      await expect(app.updateBook("u1", "b1", { title })).rejects.toMatchObject({ status: 400 });
    }
    expect(repo.updateBookInfo).not.toHaveBeenCalled();
  });

  it("他ユーザーの本・存在しない本は 404 で更新しない", async () => {
    const { app, repo } = setup();
    await expect(app.updateBook("u2", "b1", { title: "x" })).rejects.toBeInstanceOf(HttpError);
    await expect(app.updateBook("u1", "nope", { title: "x" })).rejects.toMatchObject({ status: 404 });
    expect(repo.updateBookInfo).not.toHaveBeenCalled();
  });
});
