import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import type { Llm, LlmRequest, LlmResult } from "../src/server/ai/bedrock.js";
import { NO_RECORD_NOTE } from "../src/server/ai/generate.js";
import { createApp } from "../src/server/app.js";
import type { AppConfig } from "../src/server/config.js";
import type { Book, ReadingNote, ReadingSession } from "../src/server/db/model.js";
import type { Repo } from "../src/server/db/repo.js";
import { createHandler } from "../src/server/handlers/api.js";

/** DynamoDB を使わない、Repo のインメモリ fake(userId ごとに分離) */
class FakeRepo {
  books = new Map<string, Book>();
  sessions = new Map<string, ReadingSession>();
  notes = new Map<string, ReadingNote>();
  items: Record<string, unknown>[] = [];

  async putBook(u: string, b: Book) {
    this.books.set(`${u}/${b.bookId}`, b);
  }
  async getBook(u: string, id: string) {
    return this.books.get(`${u}/${id}`);
  }
  async listBooks(u: string) {
    return [...this.books.entries()].filter(([k]) => k.startsWith(`${u}/`)).map(([, b]) => b);
  }
  async markBookFinished(u: string, id: string, at: string) {
    const b = this.books.get(`${u}/${id}`)!;
    b.finishedAt ??= at;
  }
  async listSessions(u: string, bookId: string) {
    return [...this.sessions.entries()]
      .filter(([k]) => k.startsWith(`${u}/${bookId}/`))
      .map(([, s]) => s)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  async putSession(u: string, s: ReadingSession) {
    this.sessions.set(`${u}/${s.bookId}/${s.sessionId}`, s);
  }
  async updateSession(u: string, s: ReadingSession, patch: Partial<ReadingSession>) {
    const cur = this.sessions.get(`${u}/${s.bookId}/${s.sessionId}`)!;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (cur as unknown as Record<string, unknown>)[k];
      else (cur as unknown as Record<string, unknown>)[k] = v;
    }
  }
  async findSession(u: string, bookId: string, sessionId: string) {
    const sessions = await this.listSessions(u, bookId);
    const index = sessions.findIndex((s) => s.sessionId === sessionId);
    return index < 0 ? undefined : { session: sessions[index]!, previous: sessions.slice(0, index) };
  }
  async getNote(u: string, bookId: string) {
    return this.notes.get(`${u}/${bookId}`);
  }
  async putNote(u: string, n: ReadingNote) {
    this.notes.set(`${u}/${n.bookId}`, n);
  }
  async batchPut(items: Record<string, unknown>[]) {
    this.items.push(...items);
  }
  async putItem(item: Record<string, unknown>) {
    this.items.push(item);
  }
}

const model = { modelId: "test-model", maxTokens: 100 };
const config = { prompts: { P1: model, P2: model, P3: model } } as unknown as AppConfig;

const res = (text: string): LlmResult => ({ text, modelId: "test-model", latencyMs: 1, inputTokens: 1, outputTokens: 1 });

/** system プロンプトの内容で P1/P2/P3 を見分けて返す fake Llm */
function fakeLlm(opts: { note?: () => LlmResult | Error } = {}) {
  const calls: LlmRequest[] = [];
  const llm: Llm = vi.fn(async (req: LlmRequest) => {
    calls.push(req);
    if (req.system.includes("読書ノート")) {
      const r = opts.note?.() ?? res("## この本で残ったこと\n- 気づき");
      if (r instanceof Error) throw r;
      return r;
    }
    if (req.user.includes("<user_answer>")) {
      return res("なるほど、良い気づきですね。");
    }
    return res('{"question": "いちばん印象に残ったことは?"}');
  });
  return { llm, calls };
}

function setup(opts?: Parameters<typeof fakeLlm>[0]) {
  const repo = new FakeRepo();
  const { llm, calls } = fakeLlm(opts);
  let t = Date.parse("2026-01-01T00:00:00Z");
  const now = () => new Date((t += 60_000)); // 呼ぶたびに1分進む
  const app = createApp({ repo: repo as unknown as Repo, llm, config, now, random: () => 0.5 });
  const handler = createHandler({
    app,
    repo: repo as unknown as Repo,
    verify: async (token) => {
      if (!token.startsWith("user:")) throw new Error("bad token");
      return token.slice(5);
    },
  });
  return { repo, app, handler, llm, calls };
}

function event(method: string, path: string, opts: { token?: string | null; body?: unknown; raw?: string } = {}) {
  const token = opts.token === undefined ? "user:alice" : opts.token;
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: token ? { "x-id-token": token } : {},
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const parse = (r: { body?: string }) => JSON.parse(r.body ?? "null");

describe("createApp", () => {
  it("本の作成→読書開始→終了→回答→読了の一連が通る", async () => {
    const { app, repo } = setup();
    const book = await app.createBook("alice", { title: " 本A ", author: "" });
    expect(book.title).toBe("本A");
    expect(book.author).toBeUndefined();

    const session = await app.startReading("alice", book.bookId);
    const ended = await app.endReading("alice", book.bookId, session.sessionId);
    expect(ended.question).toBe("いちばん印象に残ったことは?");
    expect(ended.durationMinutes).toBeGreaterThanOrEqual(0);

    const answered = await app.submitAnswer("alice", book.bookId, session.sessionId, {
      answer: "結論から話すことが大事だと思った",
    });
    expect(answered.reaction).toBe("なるほど、良い気づきですね。");

    const note = await app.finishBook("alice", book.bookId);
    expect(note).toMatchObject({ bookId: book.bookId, markdown: expect.stringContaining("気づき") });
    expect((await repo.getBook("alice", book.bookId))?.finishedAt).toBeDefined();
    expect((await app.getNote("alice", book.bookId)) as ReadingNote).toMatchObject({ bookId: book.bookId });
  });

  it("endReading は二重に呼んでも同じ問いを返し、AI を再度呼ばない", async () => {
    const { app, llm } = setup();
    const book = await app.createBook("alice", { title: "本A" });
    const s = await app.startReading("alice", book.bookId);
    const first = await app.endReading("alice", book.bookId, s.sessionId);
    const second = await app.endReading("alice", book.bookId, s.sessionId);
    expect(second.question).toBe(first.question);
    expect(second.questionType).toBe(first.questionType);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("問いの生成前の回答は 409", async () => {
    const { app } = setup();
    const book = await app.createBook("alice", { title: "本A" });
    const s = await app.startReading("alice", book.bookId);
    await expect(app.submitAnswer("alice", book.bookId, s.sessionId, { answer: "答え" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("スキップすると回答とリアクションが消え、skipped になる。AI は呼ばない", async () => {
    const { app, repo, llm } = setup();
    const book = await app.createBook("alice", { title: "本A" });
    const s = await app.startReading("alice", book.bookId);
    await app.endReading("alice", book.bookId, s.sessionId);
    await app.submitAnswer("alice", book.bookId, s.sessionId, { answer: "とても長い回答の文章です" });
    const callsBefore = vi.mocked(llm).mock.calls.length;
    await app.skipQuestion("alice", book.bookId, s.sessionId);
    const saved = (await repo.listSessions("alice", book.bookId))[0]!;
    expect(saved).toMatchObject({ skipped: true });
    expect(saved.answer).toBeUndefined();
    expect(saved.reaction).toBeUndefined();
    expect(vi.mocked(llm).mock.calls.length).toBe(callsBefore);
  });

  it("回答するとスキップ状態が解除される", async () => {
    const { app, repo } = setup();
    const book = await app.createBook("alice", { title: "本A" });
    const s = await app.startReading("alice", book.bookId);
    await app.endReading("alice", book.bookId, s.sessionId);
    await app.skipQuestion("alice", book.bookId, s.sessionId);
    await app.submitAnswer("alice", book.bookId, s.sessionId, { answer: "やっぱり答えます、長めに" });
    const saved = (await repo.listSessions("alice", book.bookId))[0]!;
    expect(saved.skipped).toBe(false);
    expect(saved.answer).toBe("やっぱり答えます、長めに");
  });

  it("自由入力は AI を呼ばずに保存される", async () => {
    const { app, repo, llm } = setup();
    const book = await app.createBook("alice", { title: "本A" });
    const s = await app.startReading("alice", book.bookId);
    await app.submitFreeNote("alice", book.bookId, s.sessionId, { note: " メモ " });
    expect((await repo.listSessions("alice", book.bookId))[0]!.freeNote).toBe("メモ");
    expect(llm).not.toHaveBeenCalled();
  });

  it("cleanText: 空・文字列以外・4000字超は 400、ちょうど4000字は通る", async () => {
    const { app } = setup();
    await expect(app.createBook("alice", { title: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(app.createBook("alice", { title: 123 })).rejects.toMatchObject({ status: 400 });
    await expect(app.createBook("alice", {})).rejects.toMatchObject({ status: 400 });
    await expect(app.createBook("alice", { title: "あ".repeat(4001) })).rejects.toMatchObject({ status: 400 });
    await expect(app.createBook("alice", { title: "あ".repeat(4000) })).resolves.toBeDefined();
  });

  it("他のユーザーの本・セッションは 404", async () => {
    const { app } = setup();
    const book = await app.createBook("alice", { title: "本A" });
    const s = await app.startReading("alice", book.bookId);
    await expect(app.getBook("bob", book.bookId)).rejects.toMatchObject({ status: 404 });
    await expect(app.startReading("bob", book.bookId)).rejects.toMatchObject({ status: 404 });
    await expect(app.endReading("bob", book.bookId, s.sessionId)).rejects.toMatchObject({ status: 404 });
    await expect(app.finishBook("bob", book.bookId)).rejects.toMatchObject({ status: 404 });
    await expect(app.getNote("bob", book.bookId)).rejects.toMatchObject({ status: 404 });
    await expect(app.endReading("alice", book.bookId, "s_unknown")).rejects.toMatchObject({ status: 404 });
    expect(await app.listBooks("bob")).toEqual([]);
  });

  it("回答がない本の読了は AI を呼ばず「記録なし」を返す", async () => {
    const { app, llm } = setup();
    const book = await app.createBook("alice", { title: "本A" });
    const note = await app.finishBook("alice", book.bookId);
    expect(note).toEqual({ markdown: NO_RECORD_NOTE, empty: true });
    expect(llm).not.toHaveBeenCalled();
    expect(await app.getNote("alice", book.bookId)).toEqual({ markdown: NO_RECORD_NOTE, empty: true });
  });

  it("本の一覧は登録の新しい順", async () => {
    const { app } = setup();
    const a = await app.createBook("alice", { title: "A" });
    const b = await app.createBook("alice", { title: "B" });
    expect((await app.listBooks("alice")).map((x) => x.bookId)).toEqual([b.bookId, a.bookId]);
  });
});

describe("createHandler", () => {
  it("トークンなしは 401、不正トークンも 401", async () => {
    const { handler } = setup();
    expect((await handler(event("GET", "/api/books", { token: null }))).statusCode).toBe(401);
    expect((await handler(event("GET", "/api/books", { token: "garbage" }))).statusCode).toBe(401);
  });

  it("未知のルート・メソッドは 404(認証より先に判定)", async () => {
    const { handler } = setup();
    expect((await handler(event("GET", "/api/unknown", { token: null }))).statusCode).toBe(404);
    expect((await handler(event("DELETE", "/api/books"))).statusCode).toBe(404);
  });

  it("不正な JSON・配列・文字列の body は 400", async () => {
    const { handler } = setup();
    expect((await handler(event("POST", "/api/books", { raw: "{oops" }))).statusCode).toBe(400);
    expect((await handler(event("POST", "/api/books", { raw: "[1]" }))).statusCode).toBe(400);
    expect((await handler(event("POST", "/api/books", { raw: '"x"' }))).statusCode).toBe(400);
  });

  it("base64 の body も読める", async () => {
    const { handler } = setup();
    const e = event("POST", "/api/books", { raw: Buffer.from(JSON.stringify({ title: "本" })).toString("base64") });
    (e as { isBase64Encoded: boolean }).isBase64Encoded = true;
    expect((await handler(e)).statusCode).toBe(201);
  });

  it("API 経由で一連の流れが通り、ステータスコードが仕様どおり", async () => {
    const { handler } = setup();
    const created = await handler(event("POST", "/api/books", { body: { title: "本A" } }));
    expect(created.statusCode).toBe(201);
    const { bookId } = parse(created);

    const started = await handler(event("POST", `/api/books/${bookId}/sessions`));
    expect(started.statusCode).toBe(201);
    const { sessionId } = parse(started);

    const ended = await handler(event("POST", `/api/books/${bookId}/sessions/${sessionId}/end`));
    expect(ended.statusCode).toBe(200);
    expect(parse(ended).question).toBeTruthy();

    const answer = await handler(
      event("POST", `/api/books/${bookId}/sessions/${sessionId}/answer`, { body: { answer: "結論から話すと伝わる" } }),
    );
    expect(answer.statusCode).toBe(200);
    expect(parse(answer).reaction).toBeTruthy();

    expect((await handler(event("POST", `/api/books/${bookId}/sessions/${sessionId}/skip`))).statusCode).toBe(204);
    expect(
      (await handler(event("POST", `/api/books/${bookId}/sessions/${sessionId}/free-note`, { body: { note: "メモ" } })))
        .statusCode,
    ).toBe(204);

    const detail = parse(await handler(event("GET", `/api/books/${bookId}`)));
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0]).toMatchObject({ skipped: true, freeNote: "メモ" });

    expect((await handler(event("POST", `/api/books/${bookId}/finish`))).statusCode).toBe(200);
    expect((await handler(event("GET", `/api/books/${bookId}/note`))).statusCode).toBe(200);
    expect((await handler(event("POST", `/api/books/${bookId}/note/regenerate`))).statusCode).toBe(200);
    expect(parse(await handler(event("GET", "/api/books"))).books).toHaveLength(1);
  });

  it("他ユーザーの bookId は 404、不正な入力は 400 で error を返す", async () => {
    const { handler } = setup();
    const { bookId } = parse(await handler(event("POST", "/api/books", { body: { title: "本A" } })));
    const other = await handler(event("GET", `/api/books/${bookId}`, { token: "user:bob" }));
    expect(other.statusCode).toBe(404);
    expect(parse(other)).toEqual({ error: "book not found" });
    const bad = await handler(event("POST", "/api/books", { body: { title: "" } }));
    expect(bad.statusCode).toBe(400);
    expect(parse(bad).error).toBeTruthy();
  });

  it("ノート生成の失敗は 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler } = setup({ note: () => new Error("bedrock down") });
    const { bookId } = parse(await handler(event("POST", "/api/books", { body: { title: "本A" } })));
    const { sessionId } = parse(await handler(event("POST", `/api/books/${bookId}/sessions`)));
    await handler(event("POST", `/api/books/${bookId}/sessions/${sessionId}/end`));
    await handler(
      event("POST", `/api/books/${bookId}/sessions/${sessionId}/answer`, { body: { answer: "回答がある状態にします" } }),
    );
    const r = await handler(event("POST", `/api/books/${bookId}/finish`));
    expect(r.statusCode).toBe(502);
    expect(parse(r)).toEqual({ error: "note generation failed" });
  });

  it("想定外の例外は 500 で詳細を漏らさない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler, repo } = setup();
    repo.listBooks = async () => {
      throw new Error("secret detail");
    };
    const r = await handler(event("GET", "/api/books"));
    expect(r.statusCode).toBe(500);
    expect(parse(r)).toEqual({ error: "internal error" });
  });

  it("POST /api/events: 不正な body は 400、正しい body は 204", async () => {
    const { handler } = setup();
    expect((await handler(event("POST", "/api/events", { body: { events: "x" } }))).statusCode).toBe(400);
    expect((await handler(event("POST", "/api/events", { body: { events: [] } }))).statusCode).toBe(204);
  });
});
