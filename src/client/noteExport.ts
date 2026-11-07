/** 読書ノートを外へ持ち出すためのテキスト(タイトル・著者・読書期間つき Markdown)を作る */

export interface NoteExportInput {
  title: string;
  author?: string;
  /** 読書期間の開始/終了(YYYY-MM-DD)。不明なら省略 */
  from?: string;
  to?: string;
  markdown: string;
}

export function buildNoteExport({ title, author, from, to, markdown }: NoteExportInput): string {
  const lines = [`# ${title}`, ""];
  if (author) lines.push(`- 著者: ${author}`);
  if (from) lines.push(`- 読書期間: ${to && to !== from ? `${from} 〜 ${to}` : from}`);
  if (lines[lines.length - 1] !== "") lines.push("");
  lines.push(markdown.trim(), "");
  return lines.join("\n");
}

/** 読書期間(最初のセッション開始日〜最後のセッション終了日 / 読了日)をローカル日付で返す */
export function readingPeriod(
  sessions: Array<{ startedAt: string; endedAt?: string }>,
  finishedAt?: string,
  toLocalDate: (iso: string) => string = (iso) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
): { from?: string; to?: string } {
  if (sessions.length === 0) return {};
  const starts = sessions.map((s) => s.startedAt).sort();
  const ends = [finishedAt, ...sessions.map((s) => s.endedAt ?? s.startedAt)].filter((x): x is string => !!x).sort();
  return { from: toLocalDate(starts[0]!), to: toLocalDate(ends[ends.length - 1]!) };
}
