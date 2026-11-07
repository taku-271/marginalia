import { ulid } from "ulid";
import type { AppConfig } from "./config.js";
import type { Llm } from "./ai/bedrock.js";
import {
  generateNote,
  generateQuestion,
  generateReaction,
  NO_RECORD_NOTE,
  type AiCallLogger,
} from "./ai/generate.js";
import { decideQuestionType } from "./ai/questionType.js";
import type { ReadingNote, ReadingSession } from "./db/model.js";
import type { Repo } from "./db/repo.js";
import { recordAiCall } from "./events/ingest.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AppDeps {
  repo: Repo;
  llm: Llm;
  config: AppConfig;
  now?: () => Date;
  random?: () => number;
}

const TZ = "Asia/Tokyo";
const dateFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }); // YYYY-MM-DD
export const toLocalDate = (iso: string) => dateFmt.format(new Date(iso));

const MAX_TEXT = 4000;

function cleanText(v: unknown, field: string): string {
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const t = v.trim();
  if (!t) throw new HttpError(400, `${field} is empty`);
  if ([...t].length > MAX_TEXT) throw new HttpError(400, `${field} is too long`);
  return t;
}

export function createApp(deps: AppDeps) {
  const { repo, llm, config } = deps;
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  const logger = (userId: string, bookId?: string, sessionId?: string): AiCallLogger =>
    (props) => recordAiCall(repo, { userId, bookId, sessionId }, props, now());

  async function requireBook(userId: string, bookId: string) {
    const book = await repo.getBook(userId, bookId);
    if (!book) throw new HttpError(404, "book not found");
    return book;
  }

  async function requireSession(userId: string, bookId: string, sessionId: string) {
    const found = await repo.findSession(userId, bookId, sessionId);
    if (!found) throw new HttpError(404, "session not found");
    return found;
  }

  async function buildNote(userId: string, bookId: string): Promise<ReadingNote | { markdown: string; empty: true }> {
    const book = await requireBook(userId, bookId);
    const sessions = (await repo.listSessions(userId, bookId)).filter((s) => s.endedAt);
    const answered = sessions
      .map((s, i) => ({ s, index: i + 1 }))
      .filter(({ s }) => s.question && s.answer && !s.skipped);
    const result = await generateNote(
      { llm, config: config.prompts.P3, log: logger(userId, bookId) },
      {
        title: book.title,
        author: book.author,
        startDate: sessions[0] ? toLocalDate(sessions[0].startedAt) : toLocalDate(now().toISOString()),
        endDate: toLocalDate((sessions.at(-1)?.endedAt ?? now().toISOString())),
        sessionCount: sessions.length,
        totalMinutes: sessions.reduce((a, s) => a + (s.durationMinutes ?? 0), 0),
        sessions: answered.map(({ s, index }) => ({
          index,
          date: toLocalDate(s.startedAt),
          question: s.question!,
          answer: s.answer!,
        })),
        freeNotes: sessions
          .filter((s) => s.freeNote)
          .map((s) => ({ date: toLocalDate(s.freeNoteAt ?? s.startedAt), note: s.freeNote! })),
      },
    );
    if (result.markdown === null) return { markdown: NO_RECORD_NOTE, empty: true };
    const note: ReadingNote = {
      bookId,
      markdown: result.markdown,
      modelId: config.prompts.P3.modelId,
      generatedAt: now().toISOString(),
    };
    await repo.putNote(userId, note);
    return note;
  }

  return {
    async createBook(userId: string, body: { title?: unknown; author?: unknown }) {
      const title = cleanText(body.title, "title");
      const author = body.author === undefined || body.author === "" ? undefined : cleanText(body.author, "author");
      const book = { bookId: `b_${ulid()}`, title, author, createdAt: now().toISOString() };
      await repo.putBook(userId, book);
      return book;
    },

    async startReading(userId: string, bookId: string) {
      await requireBook(userId, bookId);
      const session: ReadingSession = {
        bookId,
        sessionId: `s_${ulid()}`,
        startedAt: now().toISOString(),
      };
      await repo.putSession(userId, session);
      return session;
    },

    /** 読書終了 → 質問タイプをコードで決め、P1 で今回の1問を作る */
    async endReading(userId: string, bookId: string, sessionId: string) {
      const book = await requireBook(userId, bookId);
      const { session, previous } = await requireSession(userId, bookId, sessionId);
      if (session.question) {
        // 二重押下などで再度呼ばれた場合は同じ問いを返す
        return { question: session.question, questionType: session.questionType!, durationMinutes: session.durationMinutes };
      }
      const past = previous.filter((s) => s.question);
      const endedAt = now().toISOString();
      const durationMinutes = Math.max(
        0,
        Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 60000),
      );
      const type = decideQuestionType(past, random);
      const { question } = await generateQuestion(
        { llm, config: config.prompts.P1, log: logger(userId, bookId, sessionId) },
        {
          title: book.title,
          author: book.author,
          sessionNumber: past.length + 1,
          durationMinutes,
          type,
          recentSessions: past.map((s) => ({
            question: s.question!,
            answer: s.skipped ? undefined : s.answer,
          })),
          recentFreeNotes: previous.filter((s) => s.freeNote).map((s) => s.freeNote!),
        },
      );
      await repo.updateSession(userId, session, {
        endedAt,
        durationMinutes,
        questionType: type,
        question,
      });
      return { question, questionType: type, durationMinutes };
    },

    /** 回答 → P2 のひとことリアクション */
    async submitAnswer(userId: string, bookId: string, sessionId: string, body: { answer?: unknown }) {
      const answer = cleanText(body.answer, "answer");
      const book = await requireBook(userId, bookId);
      const { session } = await requireSession(userId, bookId, sessionId);
      if (!session.question) throw new HttpError(409, "question not generated yet");
      const { reaction } = await generateReaction(
        { llm, config: config.prompts.P2, log: logger(userId, bookId, sessionId) },
        { title: book.title, question: session.question, answer },
      );
      await repo.updateSession(userId, session, {
        answer,
        answeredAt: now().toISOString(),
        skipped: false,
        reaction,
      });
      return { reaction };
    },

    /** 「今日はパス」。AI は呼ばない */
    async skipQuestion(userId: string, bookId: string, sessionId: string) {
      const { session } = await requireSession(userId, bookId, sessionId);
      await repo.updateSession(userId, session, { skipped: true, answer: undefined, reaction: undefined });
    },

    /** 自由入力。AI は呼ばずそのまま保存 */
    async submitFreeNote(userId: string, bookId: string, sessionId: string, body: { note?: unknown }) {
      const note = cleanText(body.note, "note");
      const { session } = await requireSession(userId, bookId, sessionId);
      await repo.updateSession(userId, session, { freeNote: note, freeNoteAt: now().toISOString() });
    },

    /** 履歴の1回分(問い・回答・メモ)を削除する。ノートは再生成するまで変わらない */
    async deleteSession(userId: string, bookId: string, sessionId: string) {
      await requireBook(userId, bookId);
      const { session } = await requireSession(userId, bookId, sessionId);
      try {
        await repo.deleteSession(userId, session);
      } catch (err) {
        // 同時に別の操作で消えていた場合
        if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
          throw new HttpError(404, "session not found");
        }
        throw err;
      }
    },

    /** 読了 → P3 で読書ノートを作って保存 */
    async finishBook(userId: string, bookId: string) {
      await requireBook(userId, bookId);
      await repo.markBookFinished(userId, bookId, now().toISOString());
      return buildNote(userId, bookId);
    },

    /** 再生成ボタン。既存ノートを上書き */
    async regenerateNote(userId: string, bookId: string) {
      return buildNote(userId, bookId);
    },

    /** 本の一覧(登録の新しい順) */
    async listBooks(userId: string) {
      const books = await repo.listBooks(userId);
      return books.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    /** 本の詳細と全セッション(古い順)。履歴画面・読書中の再開に使う */
    async getBook(userId: string, bookId: string) {
      const book = await requireBook(userId, bookId);
      const sessions = await repo.listSessions(userId, bookId);
      return { book, sessions };
    },

    async getNote(userId: string, bookId: string) {
      await requireBook(userId, bookId);
      const note = await repo.getNote(userId, bookId);
      return note ?? { markdown: NO_RECORD_NOTE, empty: true as const };
    },
  };
}

export type App = ReturnType<typeof createApp>;
