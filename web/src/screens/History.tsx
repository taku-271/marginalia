import { useState } from "react";
import { useLoad, useVisibleView } from "../hooks";
import { formatDate } from "../format";
import { Link } from "../router";
import { api } from "../services";
import type { Book, ReadingSession } from "../types";

export function History({ bookId }: { bookId: string }) {
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ book: Book; sessions: ReadingSession[] }>(`/api/books/${bookId}`),
    [bookId],
    "history.load",
  );
  useVisibleView("history", bookId);

  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  async function remove(sessionId: string) {
    if (!confirm("この回の問い・回答・メモを削除しますか?(元に戻せません)")) return;
    setDeleting(sessionId);
    setDeleteError(false);
    try {
      await api.post(`/api/books/${bookId}/sessions/${sessionId}/delete`);
      reload();
    } catch {
      setDeleteError(true);
    } finally {
      setDeleting(null);
    }
  }

  const sessions = data?.sessions.filter((s) => s.question || s.freeNote).reverse() ?? [];

  return (
    <main className="page">
      <header className="topbar">
        <Link to={{ name: "book", bookId }} className="back">
          ← 本に戻る
        </Link>
      </header>
      <h1 className="page-title">これまでの問いと回答</h1>
      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="error">読み込めませんでした。</p>}
      {deleteError && <p className="error">削除できませんでした。もう一度お試しください。</p>}
      {data && sessions.length === 0 && <p className="empty">まだ記録がありません。</p>}
      <ol className="history">
        {sessions.map((s) => (
          <li key={s.sessionId} className="history-item">
            <p className="meta">
              {formatDate(s.startedAt)}
              {s.durationMinutes !== undefined && ` ・ ${s.durationMinutes}分`}
            </p>
            {s.question && <p className="q">{s.question}</p>}
            {s.answer ? <p className="a">{s.answer}</p> : s.question && <p className="a skipped">パス</p>}
            {s.freeNote && <p className="memo">{s.freeNote}</p>}
            <button
              type="button"
              className="btn ghost history-delete"
              disabled={deleting === s.sessionId}
              onClick={() => remove(s.sessionId)}
            >
              この回を削除
            </button>
          </li>
        ))}
      </ol>
    </main>
  );
}
