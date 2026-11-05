import { charLength, type QuestionType } from "../shared/questionTypes.js";
import type { ApiClient } from "./apiClient.js";
import type { EventTracker } from "./eventTracker.js";

/**
 * 画面から呼ぶ操作。API 呼び出しとイベント記録をひとまとめにする。
 * イベントには本文を入れず、文字数・秒数などのメタ情報だけを入れる。
 */

export const FREE_NOTE_PROMPT = "他に残しておきたいことは?";

export function createReadingFlow(api: ApiClient, events: EventTracker) {
  return {
    async createBook(title: string, author?: string) {
      const book = await api.post<{ bookId: string }>("/api/books", { title, author });
      events.track("book_create", {}, { bookId: book.bookId });
      return book;
    },

    async startReading(bookId: string) {
      const s = await api.post<{ sessionId: string }>(`/api/books/${bookId}/sessions`);
      events.track("reading_start", {}, { bookId, sessionId: s.sessionId });
      return s;
    },

    /** 読書終了 → 問いを受け取る。返り値の shown() を問いが画面に出たときに呼ぶ */
    async endReading(bookId: string, sessionId: string) {
      const res = await api.post<{ question: string; questionType: QuestionType; durationMinutes: number }>(
        `/api/books/${bookId}/sessions/${sessionId}/end`,
      );
      const ctx = { bookId, sessionId };
      events.track("reading_end", { durationMinutes: res.durationMinutes }, ctx);
      return {
        ...res,
        /** 問いの表示 → 回答 / スキップまでの可視時間を計る */
        shown() {
          events.track(
            "question_shown",
            { questionType: res.questionType, questionLength: charLength(res.question) },
            { ...ctx, screen: "question" },
          );
          const sw = events.stopwatch();
          return {
            async answer(answer: string) {
              const secondsToAnswer = sw.stop();
              const r = await api.post<{ reaction: string }>(
                `/api/books/${bookId}/sessions/${sessionId}/answer`,
                { answer },
              );
              events.track(
                "answer_submit",
                { questionType: res.questionType, answerLength: charLength(answer.trim()), secondsToAnswer },
                ctx,
              );
              return r.reaction;
            },
            async skip() {
              const secondsToSkip = sw.stop();
              await api.post(`/api/books/${bookId}/sessions/${sessionId}/skip`);
              events.track("question_skip", { questionType: res.questionType, secondsToSkip }, ctx);
            },
          };
        },
      };
    },

    /** 自由入力。空なら free_note_skip だけ記録して API は呼ばない */
    async submitFreeNote(bookId: string, sessionId: string, note: string) {
      const trimmed = note.trim();
      if (!trimmed) {
        events.track("free_note_skip", {}, { bookId, sessionId });
        return;
      }
      await api.post(`/api/books/${bookId}/sessions/${sessionId}/free-note`, { note: trimmed });
      events.track("free_note_submit", { noteLength: charLength(trimmed) }, { bookId, sessionId });
    },

    async finishBook(bookId: string, sessionCount: number) {
      const note = await api.post<{ markdown: string; empty?: boolean }>(`/api/books/${bookId}/finish`);
      events.track("book_finish", { sessionCount }, { bookId });
      return note;
    },

    async regenerateNote(bookId: string) {
      events.track("note_regenerate", {}, { bookId });
      return api.post<{ markdown: string; empty?: boolean }>(`/api/books/${bookId}/note/regenerate`);
    },

    /** 読書ノート / 履歴画面を開いたときに呼び、閉じるときに返り値の close() を呼ぶ */
    openView(kind: "note" | "history", bookId?: string) {
      events.screenView(kind, { bookId });
      const sw = events.stopwatch();
      let closed = false;
      return {
        close() {
          if (closed) return;
          closed = true;
          events.track(kind === "note" ? "note_view" : "history_view", { secondsViewed: sw.stop() }, { bookId, screen: kind });
        },
      };
    },
  };
}
