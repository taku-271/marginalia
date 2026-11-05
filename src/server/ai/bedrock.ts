import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import type { PromptModelConfig } from "../config.js";

type DocumentType = NonNullable<ConverseCommandInput["additionalModelRequestFields"]>;

export interface LlmRequest {
  system: string;
  user: string;
  config: PromptModelConfig;
}

export interface LlmResult {
  text: string;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
}

/** テストで差し替えられるように関数型で受け渡す */
export type Llm = (req: LlmRequest) => Promise<LlmResult>;

/** 呼び出しが例外で終わったときにもトークン数・レイテンシを記録できるようにするエラー */
export class LlmCallError extends Error {
  constructor(
    message: string,
    readonly latencyMs: number,
    readonly modelId: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function createBedrockLlm(client: BedrockRuntimeClient): Llm {
  return async ({ system, user, config }) => {
    const started = Date.now();
    try {
      const res = await client.send(
        new ConverseCommand({
          modelId: config.modelId,
          system: [{ text: system }],
          messages: [{ role: "user", content: [{ text: user }] }],
          inferenceConfig: {
            maxTokens: config.maxTokens,
            ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          },
          ...(config.additionalModelRequestFields
            ? { additionalModelRequestFields: config.additionalModelRequestFields as DocumentType }
            : {}),
        }),
      );
      // thinking が有効なモデルでは reasoningContent ブロックも返るので text だけを拾う
      const text = (res.output?.message?.content ?? [])
        .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
        .join("")
        .trim();
      return {
        text,
        modelId: config.modelId,
        latencyMs: Date.now() - started,
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        stopReason: res.stopReason,
      };
    } catch (err) {
      throw new LlmCallError(
        err instanceof Error ? err.message : String(err),
        Date.now() - started,
        config.modelId,
        { cause: err },
      );
    }
  };
}
