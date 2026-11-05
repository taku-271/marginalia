import { useEffect, useState, type FormEvent } from "react";
import { useLoad } from "../hooks";
import { Link, useRouter } from "../router";
import { api, events, flow } from "../services";
import type { Book } from "../types";

export function Home() {
  const { navigate } = useRouter();
  const { data, error, loading, reload } = useLoad(
    async () => (await api.get<{ books: Book[] }>("/api/books")).books,
    [],
    "home.load",
  );
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => events.screenView("home"), []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const book = await flow.createBook(title.trim(), author.trim() || undefined);
      navigate({ name: "book", bookId: book.bookId });
    } catch (err) {
      events.captureError("home.createBook", err);
      alert("本を登録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  const reading = data?.filter((b) => !b.finishedAt) ?? [];
  const finished = data?.filter((b) => b.finishedAt) ?? [];

  return (
    <main className="page">
      <header className="topbar">
        <h1 className="wordmark small">marginalia</h1>
      </header>

      {adding ? (
        <form className="card stack" onSubmit={add}>
          <label className="field">
            <span>タイトル</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
          </label>
          <label className="field">
            <span>著者(任意)</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
              やめる
            </button>
            <button className="btn primary" disabled={busy || !title.trim()}>
              登録する
            </button>
          </div>
        </form>
      ) : (
        <button className="btn primary block" onClick={() => setAdding(true)}>
          + 本を登録する
        </button>
      )}

      {loading && <p className="muted">読み込み中…</p>}
      {error && (
        <p className="error">
          読み込めませんでした。<button className="link" onClick={() => void reload()}>再読み込み</button>
        </p>
      )}

      {data && data.length === 0 && !adding && (
        <p className="empty">紙の本を1冊登録して、読みはじめましょう。</p>
      )}

      {reading.length > 0 && (
        <section>
          <h2 className="section-title">読んでいる本</h2>
          <BookList books={reading} />
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <h2 className="section-title">読み終えた本</h2>
          <BookList books={finished} />
        </section>
      )}
    </main>
  );
}

function BookList({ books }: { books: Book[] }) {
  return (
    <ul className="book-list">
      {books.map((b) => (
        <li key={b.bookId}>
          <Link to={{ name: "book", bookId: b.bookId }} className="book-item">
            <span className="book-title">{b.title}</span>
            {b.author && <span className="book-author">{b.author}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
