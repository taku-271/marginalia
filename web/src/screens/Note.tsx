import { useState } from "react";
import Markdown from "react-markdown";
import { useLoad, useVisibleView } from "../hooks";
import { Link } from "../router";
import { api, events, flow } from "../services";
import type { NoteResponse } from "../../../src/client/readingFlow";
import { buildNoteExport, readingPeriod } from "../../../src/client/noteExport";
import type { Book, ReadingSession } from "../types";

export function Note({ bookId }: { bookId: string }) {
  const { data, setData, error, loading } = useLoad(
    () => api.get<NoteResponse>(`/api/books/${bookId}/note`),
    [bookId],
    "note.load",
  );
  const [regenerating, setRegenerating] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

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

  async function exportText() {
    const detail = await api.get<{ book: Book; sessions: ReadingSession[] }>(`/api/books/${bookId}`);
    return buildNoteExport({
      title: detail.book.title,
      author: detail.book.author,
      ...readingPeriod(detail.sessions, detail.book.finishedAt),
      markdown: data!.markdown,
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(await exportText());
      setShareStatus("コピーしました");
    } catch (err) {
      events.captureError("note.copy", err);
      setShareStatus("コピーできませんでした");
    }
  }

  async function share() {
    try {
      const text = await exportText();
      await navigator.share({ text });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      events.captureError("note.share", err);
      setShareStatus("共有できませんでした");
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
          {!empty && !regenerating && (
            <>
              <button className="btn block" onClick={copy}>
                Markdown をコピー
              </button>
              {canShare && (
                <button className="btn ghost block" onClick={share}>
                  共有
                </button>
              )}
              {shareStatus && (
                <p className="muted" role="status">
                  {shareStatus}
                </p>
              )}
            </>
          )}
          <button className="btn ghost block" onClick={regenerate} disabled={regenerating}>
            作り直す
          </button>
        </>
      )}
    </main>
  );
}
