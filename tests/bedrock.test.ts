import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it } from "vitest";
import { createBedrockLlm, LlmCallError } from "../src/server/ai/bedrock.js";

describe("createBedrockLlm", () => {
  const br = mockClient(BedrockRuntimeClient);

  it("Converse の入力を組み立て、text ブロックとトークン数を返す", async () => {
    br.reset();
    br.on(ConverseCommand).resolves({
      output: {
        message: {
          role: "assistant",
          content: [{ reasoningContent: { reasoningText: { text: "考え中" } } }, { text: ' {"question":"Q"} ' }],
        },
      },
      usage: { inputTokens: 321, outputTokens: 12, totalTokens: 333 },
      stopReason: "end_turn",
      metrics: { latencyMs: 400 },
    });
    const llm = createBedrockLlm(new BedrockRuntimeClient({ region: "ap-northeast-1" }));
    const r = await llm({
      system: "SYS",
      user: "USER",
      config: {
        modelId: "jp.anthropic.claude-haiku-5-5",
        maxTokens: 200,
        additionalModelRequestFields: { thinking: { type: "disabled" } },
      },
    });
    expect(r).toMatchObject({ text: '{"question":"Q"}', inputTokens: 321, outputTokens: 12, stopReason: "end_turn" });

    const input = br.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(input).toEqual({
      modelId: "jp.anthropic.claude-haiku-5-5",
      system: [{ text: "SYS" }],
      messages: [{ role: "user", content: [{ text: "USER" }] }],
      inferenceConfig: { maxTokens: 200 }, // temperature は指定時のみ送る
      additionalModelRequestFields: { thinking: { type: "disabled" } },
    });
  });

  it("temperature を指定したら送る", async () => {
    br.reset();
    br.on(ConverseCommand).resolves({ output: { message: { role: "assistant", content: [{ text: "x" }] } } });
    const llm = createBedrockLlm(new BedrockRuntimeClient({ region: "ap-northeast-1" }));
    await llm({ system: "s", user: "u", config: { modelId: "m", maxTokens: 10, temperature: 0.7 } });
    expect(br.commandCalls(ConverseCommand)[0]!.args[0].input.inferenceConfig).toEqual({ maxTokens: 10, temperature: 0.7 });
  });

  it("例外は LlmCallError に包む", async () => {
    br.reset();
    br.on(ConverseCommand).rejects(new Error("ThrottlingException"));
    const llm = createBedrockLlm(new BedrockRuntimeClient({ region: "ap-northeast-1" }));
    await expect(llm({ system: "s", user: "u", config: { modelId: "m", maxTokens: 10 } })).rejects.toBeInstanceOf(LlmCallError);
  });
});
