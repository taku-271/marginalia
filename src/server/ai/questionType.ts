import { charLength, type QuestionType } from "../../shared/questionTypes.js";

/** ローテーションに必要な過去セッションの情報(古い順) */
export interface PastSession {
  questionType?: QuestionType;
  answer?: string;
  skipped?: boolean;
  freeNote?: string;
}

const ROTATION: QuestionType[] = ["insight", "apply", "doubt", "experience", "action"];
const FOLLOWUP_MIN_CHARS = 40;
const FOLLOWUP_PROBABILITY = 0.5;
const SKIP_STREAK_FOR_INSIGHT = 3;
const ACTION_EVERY_N_SESSIONS = 3;

/**
 * 今回の質問タイプをコードで決める。
 *
 * 適用順:
 *   1. その本の1回目 → insight
 *   4. 直近3回連続でスキップ → insight(最も答えやすい)
 *   2. 前回の回答 or 自由入力が40字以上 → 50%で followup
 *   3. insight/apply/doubt/experience/action から直近2回で使っていないものをランダム
 *   5. action はその本で「3セッションに1回」を上限(n回目までに floor(n/3) 回まで)
 *
 * ルール4はルール2より優先する(答えられていない状態で深掘りを重ねない)。
 */
export function decideQuestionType(
  previous: PastSession[],
  random: () => number = Math.random,
): QuestionType {
  const sessionNumber = previous.length + 1;

  // 1
  if (previous.length === 0) return "insight";

  // 4
  const lastN = previous.slice(-SKIP_STREAK_FOR_INSIGHT);
  if (lastN.length === SKIP_STREAK_FOR_INSIGHT && lastN.every(isSkipped)) return "insight";

  // 2
  const last = previous[previous.length - 1]!;
  const lastAnswer = last.skipped ? "" : last.answer;
  if (
    (charLength(lastAnswer) >= FOLLOWUP_MIN_CHARS || charLength(last.freeNote) >= FOLLOWUP_MIN_CHARS) &&
    random() < FOLLOWUP_PROBABILITY
  ) {
    return "followup";
  }

  // 3 + 5
  const recent = new Set(previous.slice(-2).map((s) => s.questionType));
  const actionCount = previous.filter((s) => s.questionType === "action").length;
  const actionAllowed = actionCount < Math.floor(sessionNumber / ACTION_EVERY_N_SESSIONS);
  const candidates = ROTATION.filter(
    (t) => !recent.has(t) && (t !== "action" || actionAllowed),
  );
  // 理論上空にはならないが、念のため
  if (candidates.length === 0) return "insight";
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]!;
}

function isSkipped(s: PastSession): boolean {
  return s.skipped === true || !s.answer;
}
