/**
 * ユーザー入力をプロンプトのタグ内に埋め込む前の無害化。
 * プロンプトで使っているタグ名と同じ開始・終了タグだけを全角山括弧に置き換え、
 * ユーザーが `</user_answer>` などでデータ領域から抜け出せないようにする。
 * それ以外の文字はそのまま残す(P3 で本人の言葉を正確に引用するため)。
 */
const TAGS = ["book", "session", "sessions", "history", "user_notes", "user_answer", "question"];
const TAG_RE = new RegExp(`<(/?)\\s*(${TAGS.join("|")})\\b([^>]*)>`, "gi");

export function escapeUserText(text: string): string {
  return text.replace(TAG_RE, (_m, slash: string, name: string, rest: string) => `＜${slash}${name}${rest}＞`);
}

/** 改行を含む回答をリスト項目の中に入れるとき、行頭を字下げして構造を崩さない */
export function indentContinuation(text: string, indent: string): string {
  return text.replace(/\r?\n/g, `\n${indent}`);
}
