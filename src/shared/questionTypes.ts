export const QUESTION_TYPES = [
  "insight",
  "apply",
  "doubt",
  "experience",
  "followup",
  "action",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** P1 の {{typeDescription}} に入れる「意図」 */
export const QUESTION_TYPE_DESCRIPTIONS: Record<QuestionType, string> = {
  insight: "印象に残ったこと",
  apply: "仕事・生活への応用",
  doubt: "違和感・反論",
  experience: "自分の経験との重なり",
  followup: "前回の回答の深掘り",
  action: "小さな行動に落とす",
};

/** P1 が失敗したときの固定フォールバック文 */
export const FALLBACK_QUESTIONS: Record<QuestionType, string> = {
  insight: "今日読んだ中で、いちばん頭に残っていることは?",
  apply: "今日の内容、今の仕事で使えそうな場面はありますか?",
  doubt: "「本当にそうかな?」と引っかかったところはありますか?",
  experience: "読んでいて、自分の過去の経験を思い出した場面はありますか?",
  followup: "前回書いたことについて、今日読んで何か付け足したくなったことはありますか?",
  action: "今日の内容から、明日1つだけ試すとしたら何をしますか?",
};

/** 日本語の「字数」。サロゲートペアを1字と数える */
export function charLength(text: string | undefined | null): number {
  return text ? [...text].length : 0;
}
