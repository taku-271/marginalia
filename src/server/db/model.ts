import type { QuestionType } from "../../shared/questionTypes.js";

/**
 * シングルテーブル設計(PK はすべて USER#<userId>)
 *
 *   本            SK: BOOK#<bookId>
 *   読書セッション SK: SESSION#<bookId>#<startedAt(UTC ISO)>#<sessionId>   (本ごとに古い順で並ぶ)
 *   読書ノート     SK: NOTE#<bookId>
 *   イベント       SK: EVENT#<timestamp(UTC ISO)>#<eventId>
 *
 * 自由入力はセッションの freeNote 属性として保存する。
 */

export const keys = {
  pk: (userId: string) => `USER#${userId}`,
  book: (bookId: string) => `BOOK#${bookId}`,
  sessionPrefix: (bookId: string) => `SESSION#${bookId}#`,
  session: (bookId: string, startedAt: string, sessionId: string) =>
    `SESSION#${bookId}#${startedAt}#${sessionId}`,
  note: (bookId: string) => `NOTE#${bookId}`,
  event: (timestampUtc: string, eventId: string) => `EVENT#${timestampUtc}#${eventId}`,
};

export interface Book {
  bookId: string;
  title: string;
  author?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface ReadingSession {
  bookId: string;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  durationMinutes?: number;
  questionType?: QuestionType;
  question?: string;
  answer?: string;
  answeredAt?: string;
  skipped?: boolean;
  reaction?: string;
  freeNote?: string;
  freeNoteAt?: string;
}

export interface ReadingNote {
  bookId: string;
  markdown: string;
  modelId: string;
  generatedAt: string;
}
