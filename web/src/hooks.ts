import { useCallback, useEffect, useState } from "react";
import { events, flow } from "./services";

/** 非同期の読み込み。失敗は client_error に記録する */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], where: string) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await load());
    } catch (err) {
      events.captureError(where, err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, setData, error, loading, reload: run };
}

/** 画面を開いてから閉じるまでの可視時間を note_view / history_view に記録する */
export function useVisibleView(kind: "note" | "history", bookId: string) {
  useEffect(() => {
    const view = flow.openView(kind, bookId);
    const onHide = () => view.close();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      view.close();
    };
  }, [kind, bookId]);
}
