import { describe, expect, it } from "vitest";
import { createApp, HttpError } from "../src/server/app.js";
import { createHandler } from "../src/server/handlers/api.js";
import type { Book, ReadingSession } from "../src/server/db/model.js";
import type { Repo } from "../src/server/db/repo.js";

/** app.ts が使う分だけのインメモリ Repo */
function fakeRepo() {
  const books = new Map<string, Book>();
  const sessions = new Map<string, ReadingSession>(); // `${userId}|${sessionId}`
  const repo = {
    getBook: async (u: string, id: string) => (books.get(`${u}|${id}`)),
    listSessions: async (u: string, bookId: string) =>
      [...sessions.entries()]
        .filter(([k, s]) => k.startsWith(`${u}|`) && s.bookId === bookId)
        .map(([, s]) => s)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    findSession: async (u: string, bookId: string, sessionId: string) => {
      const list = await repo.listSessions(u, bookId);
      const i = list.findIndex((s) => s.sessionId === sessionId);
      return i < 0 ? undefined : { session: list[i]!, previous: list.slice(0, i) };
    },
    deleteSession: async (u: string, s: ReadingSession) => {
      if (!sessions.delete(`${u}|${s.sessionId}`)) {
        throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
      }
    },
  };
  return { repo: repo as unknown as Repo, books, sessions };
}

const book: Book = { bookId: "b1", title: "本", createdAt: "2026-11-01T00:00:00Z" };
const mk = (id: string, at: string): ReadingSession => ({
  bookId: "b1",
  sessionId: id,
  startedAt: at,
  question: `問い${id}`,
  answer: `答え${id}`,
});

function setup() {
  const f = fakeRepo();
  f.books.set("u1|b1", book);
  f.sessions.set("u1|s1", mk("s1", "2026-11-02T00:00:00Z"));
  f.sessions.set("u1|s2", mk("s2", "2026-11-03T00:00:00Z"));
  const app = createApp({ repo: f.repo, llm: {} as never, config: {} as never });
  return { ...f, app };
}

describe("deleteSession", () => {
  it("指定した1回分だけを消し、再読み込みしても戻らない", async () => {
    const { app } = setup();
    await app.deleteSession("u1", "b1", "s1");
    const { sessions } = await app.getBook("u1", "b1");
    expect(sessions.map((s) => s.sessionId)).toEqual(["s2"]);
  });

  it("存在しない記録・本は 404", async () => {
    const { app } = setup();
    await expect(app.deleteSession("u1", "b1", "nope")).rejects.toMatchObject({ status: 404 });
    await expect(app.deleteSession("u1", "nope", "s1")).rejects.toBeInstanceOf(HttpError);
  });

  it("他人の記録は消せない", async () => {
    const { app, sessions } = setup();
    await expect(app.deleteSession("u2", "b1", "s1")).rejects.toMatchObject({ status: 404 });
    expect(sessions.has("u1|s1")).toBe(true);
  });

  it("同時に消されていた場合も 404", async () => {
    const { app, sessions } = setup();
    const real = (app as unknown as { deleteSession: typeof app.deleteSession }).deleteSession;
    sessions.delete("u1|s1"); // 先に消える
    await expect(real("u1", "b1", "s1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("POST /api/books/:id/sessions/:id/delete", () => {
  const call = (h: ReturnType<typeof createHandler>, path: string, token?: string) =>
    h({
      requestContext: { http: { method: "POST" } },
      rawPath: path,
      headers: token ? { "x-id-token": token } : {},
    } as never);

  it("204 を返して消える。未認証は 401、他人は 404", async () => {
    const { app, repo, sessions } = setup();
    const h = createHandler({
      app,
      repo,
      verify: async (t) => {
        if (t === "bad") throw new Error("x");
        return t;
      },
    });
    expect((await call(h, "/api/books/b1/sessions/s1/delete")).statusCode).toBe(401);
    expect((await call(h, "/api/books/b1/sessions/s1/delete", "bad")).statusCode).toBe(401);
    expect((await call(h, "/api/books/b1/sessions/s1/delete", "u2")).statusCode).toBe(404);
    expect((await call(h, "/api/books/b1/sessions/s1/delete", "u1")).statusCode).toBe(204);
    expect(sessions.has("u1|s1")).toBe(false);
    expect((await call(h, "/api/books/b1/sessions/s1/delete", "u1")).statusCode).toBe(404);
  });
});
