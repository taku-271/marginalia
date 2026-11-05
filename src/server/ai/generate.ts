import type { AiCallProps } from "../../shared/events.js";
import { FALLBACK_QUESTIONS, charLength, type QuestionType } from "../../shared/questionTypes.js";
import type { PromptModelConfig } from "../config.js";
import { LlmCallError, type Llm, type LlmResult } from "./bedrock.js";
import { P1_SYSTEM, parseP1Output, renderP1User, type P1Input } from "./prompts/p1.js";
import { P2_SYSTEM, renderP2User, type P2Input } from "./prompts/p2.js";
import { P3_SYSTEM, renderP3User, type P3Input } from "./prompts/p3.js";

type PromptId = AiCallProps["prompt"];
export type AiCallLogger = (props: AiCallProps) => Promise<void>;

export interface GenerateDeps {
  llm: Llm;
  config: PromptModelConfig;
  log: AiCallLogger;
}

/** 1回の Bedrock 呼び出し。結果に関わらず呼び出し元で ai_call を記録できる形で返す */
async function call(
  deps: GenerateDeps,
  system: string,
  user: string,
): Promise<{ ok: true; result: LlmResult } | { ok: false; error: unknown; latencyMs: number }> {
  try {
    return { ok: true, result: await deps.llm({ system, user, config: deps.config }) };
  } catch (error) {
    return { ok: false, error, latencyMs: error instanceof LlmCallError ? error.latencyMs : 0 };
  }
}

function logProps(
  prompt: PromptId,
  deps: GenerateDeps,
  r: Awaited<ReturnType<typeof call>>,
  success: boolean,
  usedFallback: boolean,
): AiCallProps {
  return {
    prompt,
    modelId: deps.config.modelId,
    latencyMs: r.ok ? r.result.latencyMs : r.latencyMs,
    inputTokens: r.ok ? r.result.inputTokens : 0,
    outputTokens: r.ok ? r.result.outputTokens : 0,
    success,
    usedFallback,
  };
}

// ---------------------------------------------------------------- P1

export interface QuestionResult {
  question: string;
  usedFallback: boolean;
}

/**
 * P1: 今回の1問。JSON パース失敗(または呼び出し失敗)は1回だけ再試行し、
 * それでもだめならタイプごとの固定文にフォールバックする。
 */
export async function generateQuestion(deps: GenerateDeps, input: P1Input): Promise<QuestionResult> {
  const user = renderP1User(input);
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await call(deps, P1_SYSTEM, user);
    const question = r.ok ? parseP1Output(r.result.text) : null;
    const isLast = attempt === MAX_ATTEMPTS;
    if (!r.ok) console.error("P1 call failed", r.error);
    await deps.log(logProps("P1", deps, r, question !== null, question === null && isLast));
    if (question) return { question, usedFallback: false };
  }
  return { question: fallbackQuestion(input.type), usedFallback: true };
}

export function fallbackQuestion(type: QuestionType): string {
  return FALLBACK_QUESTIONS[type];
}

// ---------------------------------------------------------------- P2

export const SHORT_ANSWER_REACTION = "記録しました。";
const SHORT_ANSWER_CHARS = 10;
const MAX_REACTION_CHARS = 160;

/**
 * P2: ひとことリアクション。10字未満の回答には AI を呼ばず固定文を返す。
 * (スキップ時はそもそもこの関数を呼ばない)
 */
export async function generateReaction(
  deps: GenerateDeps,
  input: P2Input,
): Promise<{ reaction: string; usedFallback: boolean; calledAi: boolean }> {
  if (charLength(input.answer.trim()) < SHORT_ANSWER_CHARS) {
    return { reaction: SHORT_ANSWER_REACTION, usedFallback: false, calledAi: false };
  }
  const r = await call(deps, P2_SYSTEM, renderP2User(input));
  const reaction = r.ok ? cleanReaction(r.result.text) : null;
  if (!r.ok) console.error("P2 call failed", r.error);
  await deps.log(logProps("P2", deps, r, reaction !== null, reaction === null));
  return reaction
    ? { reaction, usedFallback: false, calledAi: true }
    : { reaction: SHORT_ANSWER_REACTION, usedFallback: true, calledAi: true };
}

function cleanReaction(text: string): string | null {
  const t = text.trim().replace(/^「([\s\S]*)」$/, "$1").trim();
  if (!t || charLength(t) > MAX_REACTION_CHARS) return null;
  return t;
}

// ---------------------------------------------------------------- P3

export const NO_RECORD_NOTE = "この本ではまだ記録がありません";

export class NoteGenerationError extends Error {}

/**
 * P3: 読書ノート。回答が1件もなければ AI を呼ばない(呼び出し側で NO_RECORD_NOTE を表示)。
 * 失敗時のフォールバック文は持たず、エラーにする(再生成ボタンで再試行してもらう)。
 */
export async function generateNote(
  deps: GenerateDeps,
  input: P3Input,
): Promise<{ markdown: string } | { markdown: null; reason: "no_answers" }> {
  if (input.sessions.length === 0) return { markdown: null, reason: "no_answers" };
  const r = await call(deps, P3_SYSTEM, renderP3User(input));
  const markdown = r.ok ? r.result.text.trim() : "";
  const truncated = r.ok && r.result.stopReason === "max_tokens";
  const success = markdown.length > 0;
  await deps.log(logProps("P3", deps, r, success, false));
  if (!success) {
    throw new NoteGenerationError(
      r.ok ? "empty note" : `note generation failed: ${String((r.error as Error)?.message ?? r.error)}`,
    );
  }
  if (truncated) console.warn("P3 output hit maxTokens; note may be truncated");
  return { markdown };
}
