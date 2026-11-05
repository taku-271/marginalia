import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { configureAuth, isSignedIn, logout } from "./auth";
import { loadConfig } from "./config";
import { RouterProvider, useRouter } from "./router";
import { BookDetail } from "./screens/BookDetail";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { Login } from "./screens/Login";
import { Reading } from "./screens/Reading";
import { events } from "./services";

// react-markdown を含むので、読書ノートを開いたときだけ読み込む
const Note = lazy(() => import("./screens/Note").then((m) => ({ default: m.Note })));

type AuthState = "loading" | "signed_out" | "signed_in" | { error: string };

export function App() {
  const [auth, setAuth] = useState<AuthState>("loading");

  useEffect(() => {
    (async () => {
      try {
        configureAuth(await loadConfig());
        setAuth((await isSignedIn()) ? "signed_in" : "signed_out");
      } catch (err) {
        setAuth({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  // イベント送信には ID トークンが要るので、ログイン後に開始する
  useEffect(() => {
    if (auth !== "signed_in") return;
    events.start();
    const onError = (e: ErrorEvent) => events.captureError("window.error", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => events.captureError("window.unhandledrejection", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [auth]);

  if (auth === "loading") return <main className="page"><p className="muted">読み込み中…</p></main>;
  if (typeof auth === "object") return <main className="page"><p className="error">{auth.error}</p></main>;
  if (auth === "signed_out") return <Login onSignedIn={() => setAuth("signed_in")} />;

  return (
    <ErrorBoundary>
      <RouterProvider>
        <Screens />
        <footer className="footer">
          <button
            className="link muted small"
            onClick={async () => {
              await events.flush();
              await logout();
              setAuth("signed_out");
            }}
          >
            ログアウト
          </button>
        </footer>
      </RouterProvider>
    </ErrorBoundary>
  );
}

function Screens() {
  const { route } = useRouter();
  switch (route.name) {
    case "home":
      return <Home />;
    case "book":
      return <BookDetail key={route.bookId} bookId={route.bookId} />;
    case "reading":
      return <Reading key={route.sessionId} bookId={route.bookId} sessionId={route.sessionId} />;
    case "note":
      return (
        <Suspense fallback={<main className="page"><p className="muted">読み込み中…</p></main>}>
          <Note key={route.bookId} bookId={route.bookId} />
        </Suspense>
      );
    case "history":
      return <History key={route.bookId} bookId={route.bookId} />;
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    events.captureError("react.render", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <main className="page">
          <p className="error">表示中に問題が起きました。</p>
          <button className="btn ghost" onClick={() => location.assign("/")}>
            最初の画面に戻る
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
