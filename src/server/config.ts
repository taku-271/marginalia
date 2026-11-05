/**
 * 環境変数からの設定。
 *
 * サンプリング(temperature)について:
 *   仕様では P1=0.7 / P2=(未指定) / P3=0.3 だが、Claude Haiku 5.5 はデフォルト以外の
 *   temperature を 400 で拒否する。そのため既定では送らず、送れるモデルに切り替えたときだけ
 *   P1_TEMPERATURE / P3_TEMPERATURE で指定する。
 *
 * thinking について:
 *   Claude Haiku 5.5 は既定で thinking が有効。maxTokens 200 程度だと思考に使い切って
 *   本文が切れるので、既定で additionalModelRequestFields に thinking: disabled を渡す。
 *   別モデル(thinking を無効化できないモデル)に切り替えたときは *_MODEL_FIELDS を "{}" などに変える。
 */

export interface PromptModelConfig {
  modelId: string;
  maxTokens: number;
  temperature?: number;
  additionalModelRequestFields?: Record<string, unknown>;
}

const DEFAULT_MODEL_ID = "jp.anthropic.claude-haiku-5-5";
const DEFAULT_FIELDS = { thinking: { type: "disabled" } };

function num(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function json(name: string, fallback: Record<string, unknown>): Record<string, unknown> | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const parsed = JSON.parse(v) as Record<string, unknown>;
  return Object.keys(parsed).length ? parsed : undefined;
}

export function getConfig() {
  const modelId = process.env.MODEL_ID || DEFAULT_MODEL_ID;
  const fields = json("MODEL_FIELDS", DEFAULT_FIELDS);
  return {
    tableName: required("TABLE_NAME"),
    bedrockRegion: process.env.BEDROCK_REGION || process.env.AWS_REGION || "ap-northeast-1",
    userPoolId: process.env.USER_POOL_ID ?? "",
    userPoolClientId: process.env.USER_POOL_CLIENT_ID ?? "",
    prompts: {
      P1: {
        modelId,
        maxTokens: 200,
        temperature: num("P1_TEMPERATURE"),
        additionalModelRequestFields: fields,
      },
      P2: {
        modelId,
        maxTokens: 200,
        temperature: num("P2_TEMPERATURE"),
        additionalModelRequestFields: fields,
      },
      P3: {
        modelId: process.env.NOTE_MODEL_ID || modelId,
        maxTokens: 1500,
        temperature: num("P3_TEMPERATURE"),
        additionalModelRequestFields: json("NOTE_MODEL_FIELDS", fields ?? {}),
      },
    } satisfies Record<"P1" | "P2" | "P3", PromptModelConfig>,
  };
}

export type AppConfig = ReturnType<typeof getConfig>;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
