import { useEffect, useState } from "react";
import { useLoad } from "../hooks";
import { Link, useRouter } from "../router";
import { api, events, flow } from "../services";
import type { Book, ReadingSession } from "../types";

export function BookDetail({ bookId }: { bookId: string }) {
  const { navigate } = useRouter();
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ book: Book; sessions: ReadingSession[] }>(`/api/books/${bookId}`),
    [bookId],
    "book_detail.load",
  );
  const [busy, setBusy] = useState<"start" | "finish" | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => events.screenView("book_detail", { bookId }), [bookId]);

  if (loading) return <Shell><p className="muted">読み込み中…</p></Shell>;
  if (error || !data) return <Shell><p className="error">本を読み込めませんでした。</p></Shell>;

  const { book, sessions } = data;
  const ended = sessions.filter((s) => s.endedAt);
  const totalMinutes = ended.reduce((a, s) => a + (s.durationMinutes ?? 0), 0);
  // 読書中、または問いに答えていないセッションがあれば再開できる
  const open = [...sessions].reverse().find((s) => !s.endedAt || (s.question && !s.answer && !s.skipped));

  async function start() {
    setBusy("start");
    try {
      const s = await flow.startReading(bookId);
      navigate({ name: "reading", bookId, sessionId: s.sessionId });
    } catch (err) {
      events.captureError("book_detail.start", err);
      alert("読書を開始できませんでした");
      setBusy(null);
    }
  }

  async function finish() {
    if (!confirm("この本を読了にして、読書ノートを作りますか?")) return;
    setBusy("finish");
    try {
      await flow.finishBook(bookId, ended.length);
      navigate({ name: "note", bookId });
    } catch (err) {
      events.captureError("book_detail.finish", err);
      alert("読書ノートを作れませんでした。時間をおいてもう一度お試しください。");
      setBusy(null);
    }
  }

  function startEdit() {
    setTitle(book.title);
    setAuthor(book.author ?? "");
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/api/books/${bookId}`, { title, author });
      setEditing(false);
      reload();
    } catch (err) {
      events.captureError("book_detail.edit", err);
      alert("保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell>
      {editing ? (
        <form className="card stack" onSubmit={saveEdit}>
          <label className="field">
            <span>タイトル</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
          </label>
          <label className="field">
            <span>著者(任意)</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
              キャンセル
            </button>
            <button className="btn primary" disabled={saving || !title.trim()}>
              保存
            </button>
          </div>
        </form>
      ) : (
        <header className="book-header">
          <h1 className="book-title large">{book.title}</h1>
          {book.author && <p className="book-author">{book.author}</p>}
          <p className="stats">
            {ended.length}回 / 合計{totalMinutes}分{book.finishedAt && " ・ 読了"}
          </p>
          <button className="btn ghost small" onClick={startEdit}>
            タイトル・著者を編集
          </button>
        </header>
      )}

      {busy === "finish" ? (
        <div className="card center">
          <p>読書ノートを作っています…</p>
          <p className="muted small">これまでの回答とメモだけをもとにまとめます</p>
        </div>
      ) : (
        <div className="stack">
          {open ? (
            <button
              className="btn primary block large"
              onClick={() => navigate({ name: "reading", bookId, sessionId: open.sessionId })}
            >
              {open.endedAt ? "問いに答える" : "読書を続ける"}
            </button>
          ) : (
            <button className="btn primary block large" onClick={start} disabled={busy !== null}>
              読みはじめる
            </button>
          )}

          <nav className="menu">
            <Link to={{ name: "history", bookId }} className="menu-item">
              これまでの問いと回答
            </Link>
            {book.finishedAt ? (
              <Link to={{ name: "note", bookId }} className="menu-item">
                読書ノート
              </Link>
            ) : (
              <button className="menu-item" onClick={finish} disabled={busy !== null || ended.length === 0}>
                読み終えた(読書ノートを作る)
              </button>
            )}
          </nav>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page">
      <header className="topbar">
        <Link to={{ name: "home" }} className="back">
          ← 本棚
        </Link>
      </header>
      {children}
    </main>
  );
}
