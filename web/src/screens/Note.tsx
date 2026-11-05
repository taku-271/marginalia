import { useState } from "react";
import Markdown from "react-markdown";
import { useLoad, useVisibleView } from "../hooks";
import { Link } from "../router";
import { api, events, flow } from "../services";
import type { NoteResponse } from "../../../src/client/readingFlow";

export function Note({ bookId }: { bookId: string }) {
  const { data, setData, error, loading } = useLoad(
    () => api.get<NoteResponse>(`/api/books/${bookId}/note`),
    [bookId],
    "note.load",
  );
  const [regenerating, setRegenerating] = useState(false);

  useVisibleView("note", bookId);

  async function regenerate() {
    if (!confirm("読書ノートを作り直しますか?(今のノートは上書きされます)")) return;
    setRegenerating(true);
    try {
      setData(await flow.regenerateNote(bookId));
    } catch (err) {
      events.captureError("note.regenerate", err);
      alert("作り直せませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setRegenerating(false);
    }
  }

  const empty = data && "empty" in data;

  return (
    <main className="page">
      <header className="topbar">
        <Link to={{ name: "book", bookId }} className="back">
          ← 本に戻る
        </Link>
      </header>
      <h1 className="page-title">読書ノート</h1>
      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="error">読み込めませんでした。</p>}
      {data && (
        <>
          {regenerating ? (
            <p className="muted">作り直しています…</p>
          ) : empty ? (
            <p className="empty">{data.markdown}</p>
          ) : (
            <article className="note">
              <Markdown>{data.markdown}</Markdown>
            </article>
          )}
          <button className="btn ghost block" onClick={regenerate} disabled={regenerating}>
            作り直す
          </button>
        </>
      )}
    </main>
  );
}
