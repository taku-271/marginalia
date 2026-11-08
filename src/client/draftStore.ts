/**
 * 回答・自由入力の下書きを端末(localStorage)に退避する。
 * アプリが閉じられたり再読み込みされたりしても、入力途中の文章が消えないようにする。
 * ストレージが使えない環境でも例外を投げず、何もしないだけにする。
 */

export type DraftKind = "answer" | "freeNote";

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function draftKey(kind: DraftKind, sessionId: string): string {
  return `marginalia:draft:${kind}:${sessionId}`;
}

export function loadDraft(storage: DraftStorage | undefined, kind: DraftKind, sessionId: string): string {
  try {
    return storage?.getItem(draftKey(kind, sessionId)) ?? "";
  } catch {
    return "";
  }
}

/** 空(空白のみ)の下書きは保存せず、残っていれば消す */
export function saveDraft(storage: DraftStorage | undefined, kind: DraftKind, sessionId: string, text: string): void {
  try {
    if (!storage) return;
    if (text.trim()) storage.setItem(draftKey(kind, sessionId), text);
    else storage.removeItem(draftKey(kind, sessionId));
  } catch {
    // 容量超過・プライベートモードなどは無視する
  }
}

export function clearDraft(storage: DraftStorage | undefined, kind: DraftKind, sessionId: string): void {
  try {
    storage?.removeItem(draftKey(kind, sessionId));
  } catch {
    // 無視
  }
}

export function browserDraftStorage(): DraftStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
