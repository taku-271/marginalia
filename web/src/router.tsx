import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * 画面数が少ないので小さな自前ルーター。
 *   /                                 home
 *   /books/:bookId                    book_detail
 *   /books/:bookId/read/:sessionId    reading → question
 *   /books/:bookId/note               note
 *   /books/:bookId/history            history
 */
export type Route =
  | { name: "home" }
  | { name: "book"; bookId: string }
  | { name: "reading"; bookId: string; sessionId: string }
  | { name: "note"; bookId: string }
  | { name: "history"; bookId: string };

export function parseRoute(path: string): Route {
  const p = path.split("/").filter(Boolean);
  if (p[0] === "books" && p[1]) {
    const bookId = decodeURIComponent(p[1]);
    if (p[2] === "read" && p[3]) return { name: "reading", bookId, sessionId: decodeURIComponent(p[3]) };
    if (p[2] === "note") return { name: "note", bookId };
    if (p[2] === "history") return { name: "history", bookId };
    return { name: "book", bookId };
  }
  return { name: "home" };
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "home":
      return "/";
    case "book":
      return `/books/${r.bookId}`;
    case "reading":
      return `/books/${r.bookId}/read/${r.sessionId}`;
    case "note":
      return `/books/${r.bookId}/note`;
    case "history":
      return `/books/${r.bookId}/history`;
  }
}

const Ctx = createContext<{ route: Route; navigate: (r: Route, replace?: boolean) => void } | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((r: Route, replace = false) => {
    const path = routePath(r);
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ route, navigate }}>{children}</Ctx.Provider>;
}

export function useRouter() {
  const c = useContext(Ctx);
  if (!c) throw new Error("RouterProvider がありません");
  return c;
}

export function Link({ to, children, className }: { to: Route; children: ReactNode; className?: string }) {
  const { navigate } = useRouter();
  return (
    <a
      href={routePath(to)}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
