import { useEffect, useRef, useState, type FormEvent } from "react";
import type { QuestionType } from "../../../src/shared/questionTypes";
import { browserDraftStorage, clearDraft, loadDraft, saveDraft } from "../../../src/client/draftStore";
import { FREE_NOTE_PROMPT } from "../../../src/client/readingFlow";
import { formatElapsed } from "../format";
import { canSpeak, primeSpeech, speak, stopSpeaking, useAutoRead } from "../speech";
import { VoiceField } from "../VoiceField";
import { Link, useRouter } from "../router";
import { api, events, flow } from "../services";
import type { Book, ReadingSession } from "../types";

type QuestionHandle = ReturnType<ReturnType<typeof flow.resumeQuestion>["shown"]>;

type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "reading"; startedAt: string }
  | { kind: "thinking" } // 問いを生成中
  | { kind: "question"; question: string; questionType: QuestionType }
  | { kind: "after"; reaction?: string } // 回答 or パスのあと。自由入力
  | { kind: "done" };

/**
 * 読書中 → 読み終えた → 今回の1問 → ひとことリアクション → 自由入力 → 本の画面へ
 */
export function Reading({ bookId, sessionId }: { bookId: string; sessionId: string }) {
  const { navigate } = useRouter();
  const [book, setBook] = useState<Book>();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ book: Book; sessions: ReadingSession[] }>(`/api/books/${bookId}`);
        const s = res.sessions.find((x) => x.sessionId === sessionId);
        if (cancelled) return;
        setBook(res.book);
        if (!s) return setStage({ kind: "error", message: "読書セッションが見つかりません" });
        if (!s.endedAt) {
          events.screenView("reading", { bookId, sessionId });
          return setStage({ kind: "reading", startedAt: s.startedAt });
        }
        if (s.question && !s.answer && !s.skipped) {
          return setStage({ kind: "question", question: s.question, questionType: s.questionType! });
        }
        setStage(s.freeNote ? { kind: "done" } : { kind: "after", reaction: s.reaction });
      } catch (err) {
        events.captureError("reading.load", err);
        if (!cancelled) setStage({ kind: "error", message: "読み込めませんでした" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, sessionId]);

  useEffect(() => {
    if (stage.kind === "done") navigate({ name: "book", bookId }, true);
  }, [stage.kind, bookId, navigate]);

  async function endReading() {
    primeSpeech(); // iOS: タップの中で一度鳴らしておくと、問いの自動読み上げが効く
    setStage({ kind: "thinking" });
    try {
      const r = await flow.endReading(bookId, sessionId);
      setStage({ kind: "question", question: r.question, questionType: r.questionType });
    } catch (err) {
      events.captureError("reading.end", err);
      setStage({ kind: "error", message: "問いを用意できませんでした。もう一度お試しください。" });
    }
  }

  return (
    <main className="page reading-page">
      <header className="topbar">
        <Link to={{ name: "book", bookId }} className="back">
          ← {book?.title ?? "本"}
        </Link>
      </header>

      {stage.kind === "loading" && <p className="muted">読み込み中…</p>}
      {stage.kind === "error" && <p className="error">{stage.message}</p>}
      {stage.kind === "reading" && <ReadingTimer startedAt={stage.startedAt} onEnd={endReading} />}
      {stage.kind === "thinking" && (
        <div className="center calm">
          <p className="muted">問いを考えています…</p>
        </div>
      )}
      {stage.kind === "question" && (
        <Question
          bookId={bookId}
          sessionId={sessionId}
          question={stage.question}
          questionType={stage.questionType}
          onDone={(reaction) => setStage({ kind: "after", reaction })}
        />
      )}
      {stage.kind === "after" && (
        <FreeNote
          bookId={bookId}
          sessionId={sessionId}
          reaction={stage.reaction}
          onDone={() => setStage({ kind: "done" })}
        />
      )}
    </main>
  );
}

function ReadingTimer({ startedAt, onEnd }: { startedAt: string; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="center calm stack">
      <p className="muted">読書中</p>
      <p className="timer" aria-live="off">{formatElapsed(now - Date.parse(startedAt))}</p>
      <p className="muted small">本を閉じたら、ボタンを押してください。</p>
      <button className="btn primary large" onClick={onEnd}>
        読み終えた
      </button>
    </div>
  );
}

function Question(props: {
  bookId: string;
  sessionId: string;
  question: string;
  questionType: QuestionType;
  onDone: (reaction?: string) => void;
}) {
  const handle = useRef<QuestionHandle | null>(null);
  const [answer, setAnswer] = useState(() => loadDraft(browserDraftStorage(), "answer", props.sessionId));
  const [usedVoice, setUsedVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoRead, setAutoRead] = useAutoRead();

  function readAloud(auto: boolean) {
    if (!handle.current) return;
    setSpeaking(true);
    speak(props.question, () => setSpeaking(false));
    handle.current.readAloud(auto);
  }

  // 表示1回につき question_shown を1回だけ記録し、ストップウォッチを始める。設定がオンなら読み上げる
  useEffect(() => {
    if (handle.current) return;
    handle.current = flow.resumeQuestion(props.bookId, props.sessionId, props.question, props.questionType).shown();
    if (autoRead && canSpeak()) readAloud(true);
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bookId, props.sessionId, props.question, props.questionType]);

  function changeAnswer(v: string) {
    setAnswer(v);
    saveDraft(browserDraftStorage(), "answer", props.sessionId, v);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !handle.current) return;
    stopSpeaking();
    setBusy(true);
    try {
      const reaction = await handle.current.answer(answer, { usedVoice });
      clearDraft(browserDraftStorage(), "answer", props.sessionId);
      props.onDone(reaction);
    } catch (err) {
      events.captureError("question.answer", err);
      alert("送信できませんでした。もう一度お試しください。");
      setBusy(false);
    }
  }

  async function skip() {
    if (!handle.current) return;
    stopSpeaking();
    setBusy(true);
    try {
      await handle.current.skip();
      clearDraft(browserDraftStorage(), "answer", props.sessionId);
      props.onDone();
    } catch (err) {
      events.captureError("question.skip", err);
      setBusy(false);
    }
  }

  return (
    <form className="stack question" onSubmit={submit}>
      <p className="question-text">{props.question}</p>
      {canSpeak() && (
        <div className="speak-row">
          <button
            type="button"
            className="chip"
            onClick={() => (speaking ? (stopSpeaking(), setSpeaking(false)) : readAloud(false))}
          >
            {speaking ? "■ 止める" : "▶ 読み上げ"}
          </button>
          <label className="toggle">
            <input type="checkbox" checked={autoRead} onChange={(e) => setAutoRead(e.target.checked)} />
            <span>次から自動で読み上げる</span>
          </label>
        </div>
      )}
      <VoiceField
        className="answer"
        value={answer}
        onChange={changeAnswer}
        onVoiceUsed={() => setUsedVoice(true)}
        placeholder="思いついたことを、ひとことで"
        rows={4}
        label="回答"
      />
      <div className="row">
        <button type="button" className="btn ghost" onClick={skip} disabled={busy}>
          今日はパス
        </button>
        <button className="btn primary" disabled={busy || !answer.trim()}>
          {busy ? "送信中…" : "残す"}
        </button>
      </div>
    </form>
  );
}

function FreeNote(props: { bookId: string; sessionId: string; reaction?: string; onDone: () => void }) {
  const [note, setNote] = useState(() => loadDraft(browserDraftStorage(), "freeNote", props.sessionId));
  const [usedVoice, setUsedVoice] = useState(false);
  const [busy, setBusy] = useState(false);

  function changeNote(v: string) {
    setNote(v);
    saveDraft(browserDraftStorage(), "freeNote", props.sessionId, v);
  }

  async function close(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      await flow.submitFreeNote(props.bookId, props.sessionId, note, { usedVoice });
      clearDraft(browserDraftStorage(), "freeNote", props.sessionId);
      props.onDone();
    } catch (err) {
      events.captureError("free_note.submit", err);
      alert("保存できませんでした");
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={close}>
      {props.reaction && <p className="reaction">{props.reaction}</p>}
      <div className="field">
        <span>{FREE_NOTE_PROMPT}</span>
        <VoiceField
          value={note}
          onChange={changeNote}
          onVoiceUsed={() => setUsedVoice(true)}
          rows={3}
          placeholder="なければそのまま閉じてOK"
          label={FREE_NOTE_PROMPT}
        />
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {note.trim() ? "残して閉じる" : "閉じる"}
        </button>
      </div>
    </form>
  );
}
