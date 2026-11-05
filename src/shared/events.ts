import { z } from "zod";
import { QUESTION_TYPES } from "./questionTypes.js";

/**
 * イベントログのスキーマ(フロント・サーバー共通)。
 *
 * props は type ごとに strict なオブジェクトで定義し、想定外のキー(=本文が紛れ込む可能性)を拒否する。
 * 本文(問い・回答・自由入力)は絶対に props に入れない。文字数などのメタ情報だけ。
 */

export const SCREENS = [
  "home",
  "book_detail",
  "reading",
  "question",
  "note",
  "history",
] as const;
export type Screen = (typeof SCREENS)[number];

const screen = z.enum(SCREENS);
const questionType = z.enum(QUESTION_TYPES);
const nonNegInt = z.number().int().nonnegative();
const seconds = z.number().nonnegative().max(60 * 60 * 24);
const empty = z.object({}).strict();

/** フロントから送ってよいイベントの props */
export const CLIENT_EVENT_PROPS = {
  app_open: empty,
  screen_view: z.object({ screen }).strict(),
  book_create: empty,
  reading_start: empty,
  reading_end: z.object({ durationMinutes: nonNegInt }).strict(),
  question_shown: z.object({ questionType, questionLength: nonNegInt }).strict(),
  answer_submit: z
    .object({
      questionType,
      answerLength: nonNegInt,
      secondsToAnswer: seconds,
      /** 音声入力(マイクボタン)を使ったか。仕様への追加 */
      usedVoice: z.boolean().optional(),
    })
    .strict(),
  question_skip: z.object({ questionType, secondsToSkip: seconds }).strict(),
  /** 問いを読み上げたとき(auto: 自動読み上げ設定によるもの)。仕様への追加 */
  question_read_aloud: z.object({ questionType, auto: z.boolean() }).strict(),
  free_note_submit: z.object({ noteLength: nonNegInt, usedVoice: z.boolean().optional() }).strict(),
  free_note_skip: empty,
  book_finish: z.object({ sessionCount: nonNegInt }).strict(),
  note_view: z.object({ secondsViewed: seconds }).strict(),
  note_regenerate: empty,
  history_view: z.object({ secondsViewed: seconds }).strict(),
  client_error: z.object({ where: z.string().max(100), message: z.string().max(200) }).strict(),
} as const;

export type ClientEventType = keyof typeof CLIENT_EVENT_PROPS;
export type ClientEventProps<T extends ClientEventType> = z.infer<(typeof CLIENT_EVENT_PROPS)[T]>;
export const CLIENT_EVENT_TYPES = Object.keys(CLIENT_EVENT_PROPS) as ClientEventType[];

/** サーバー(Lambda)だけが記録するイベントの props。フロントから送られてきても破棄する */
export const AI_CALL_PROPS = z
  .object({
    prompt: z.enum(["P1", "P2", "P3"]),
    modelId: z.string(),
    latencyMs: nonNegInt,
    inputTokens: nonNegInt,
    outputTokens: nonNegInt,
    success: z.boolean(),
    usedFallback: z.boolean(),
  })
  .strict();
export type AiCallProps = z.infer<typeof AI_CALL_PROPS>;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const envelope = z
  .object({
    eventId: z.string().regex(ULID),
    type: z.string(),
    timestamp: z.iso.datetime({ offset: true }),
    bookId: id.optional(),
    sessionId: id.optional(),
    screen: screen.optional(),
    props: z.record(z.string(), z.unknown()).default({}),
    client: z
      .object({ appVersion: z.string().max(32), standalone: z.boolean() })
      .strict(),
  })
  .strict();

export type ClientEvent = {
  [T in ClientEventType]: Omit<z.infer<typeof envelope>, "type" | "props"> & {
    type: T;
    props: ClientEventProps<T>;
  };
}[ClientEventType];

/**
 * 1件のイベントを検証する。未知の type / 想定外の props キー / 型違いは null(=破棄)。
 */
export function parseClientEvent(raw: unknown): ClientEvent | null {
  const env = envelope.safeParse(raw);
  if (!env.success) return null;
  const { type, props } = env.data;
  if (!Object.hasOwn(CLIENT_EVENT_PROPS, type)) return null;
  const schema = CLIENT_EVENT_PROPS[type as ClientEventType];
  const p = schema.safeParse(props);
  if (!p.success) return null;
  return { ...env.data, type, props: p.data } as ClientEvent;
}

export { MAX_EVENTS_PER_REQUEST } from "./limits.js";

export const EventsRequest = z.object({ events: z.array(z.unknown()) });
