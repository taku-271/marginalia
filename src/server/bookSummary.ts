import type { Book, ReadingSession } from "./db/model.js";

/** 本棚に出す本ごとの読書サマリ。読書履歴がなければ sessionCount は 0 で、他は付かない */
export interface BookSummary extends Book {
  /** 読み終えた(endedAt のある)セッションの数 */
  sessionCount: number;
  /** 最後に読んだ日時(最後のセッションの endedAt、なければ startedAt) */
  lastReadAt?: string;
  /** 問いが出たまま未回答・未スキップのセッション(最新のもの) */
  pendingSessionId?: string;
}

export function summarizeBooks(books: Book[], sessions: ReadingSession[]): BookSummary[] {
  const byBook = new Map<string, ReadingSession[]>();
  for (const s of sessions) {
    const list = byBook.get(s.bookId);
    if (list) list.push(s);
    else byBook.set(s.bookId, [s]);
  }
  return books.map((book) => {
    const list = byBook.get(book.bookId) ?? [];
    const summary: BookSummary = { ...book, sessionCount: list.filter((s) => s.endedAt).length };
    for (const s of list) {
      const at = s.endedAt ?? s.startedAt;
      if (!summary.lastReadAt || at > summary.lastReadAt) summary.lastReadAt = at;
      if (s.question && !s.answer && !s.skipped) {
        const cur = list.find((x) => x.sessionId === summary.pendingSessionId);
        if (!cur || s.startedAt > cur.startedAt) summary.pendingSessionId = s.sessionId;
      }
    }
    return summary;
  });
}
