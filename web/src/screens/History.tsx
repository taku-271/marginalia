import { useLoad, useVisibleView } from "../hooks";
import { formatDate } from "../format";
import { Link } from "../router";
import { api } from "../services";
import type { Book, ReadingSession } from "../types";

export function History({ bookId }: { bookId: string }) {
  const { data, error, loading } = useLoad(
    () => api.get<{ book: Book; sessions: ReadingSession[] }>(`/api/books/${bookId}`),
    [bookId],
    "history.load",
  );
  useVisibleView("history", bookId);

  const sessions = data?.sessions.filter((s) => s.question || s.freeNote || s.memos?.length).reverse() ?? [];

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
      {data && sessions.length === 0 && <p className="empty">まだ記録がありません。</p>}
      <ol className="history">
        {sessions.map((s) => (
          <li key={s.sessionId} className="history-item">
            <p className="meta">
              {formatDate(s.startedAt)}
              {s.durationMinutes !== undefined && ` ・ ${s.durationMinutes}分`}
            </p>
            {s.memos?.map((m) => (
              <p key={m.at} className="memo">
                📝 {m.text}
              </p>
            ))}
            {s.question && <p className="q">{s.question}</p>}
            {s.answer ? <p className="a">{s.answer}</p> : s.question && <p className="a skipped">パス</p>}
            {s.freeNote && <p className="memo">{s.freeNote}</p>}
          </li>
        ))}
      </ol>
    </main>
  );
}
