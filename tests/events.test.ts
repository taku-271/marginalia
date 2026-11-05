import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { ulid } from "ulid";
import { beforeEach, describe, expect, it } from "vitest";
import { parseClientEvent } from "../src/shared/events.js";
import { createDocClient, Repo } from "../src/server/db/repo.js";
import { ingestEvents, recordAiCall, toUtcIso } from "../src/server/events/ingest.js";

const base = () => ({
  eventId: ulid(),
  type: "answer_submit",
  timestamp: "2026-11-05T22:14:03.120+09:00",
  bookId: "b_1",
  sessionId: "s_1",
  screen: "question",
  props: { questionType: "apply", answerLength: 48, secondsToAnswer: 32 },
  client: { appVersion: "0.1.0", standalone: true },
});

describe("parseClientEvent", () => {
  it("正しいイベントを通す", () => {
    expect(parseClientEvent(base())).not.toBeNull();
  });

  it("未知の type は破棄", () => {
    expect(parseClientEvent({ ...base(), type: "unknown" })).toBeNull();
    expect(parseClientEvent({ ...base(), type: "__proto__" })).toBeNull();
  });

  it("サーバー専用の ai_call はフロントから受け付けない", () => {
    expect(
      parseClientEvent({
        ...base(),
        type: "ai_call",
        props: { prompt: "P1", modelId: "m", latencyMs: 1, inputTokens: 1, outputTokens: 1, success: true, usedFallback: false },
      }),
    ).toBeNull();
  });

  it("props に想定外のキーがあれば破棄(本文の混入防止)", () => {
    expect(parseClientEvent({ ...base(), props: { ...base().props, answer: "本文" } })).toBeNull();
  });

  it("イベント本体に userId などの余計なキーがあれば破棄", () => {
    expect(parseClientEvent({ ...base(), userId: "someone-else" })).toBeNull();
  });

  it("client_error の message は200字まで", () => {
    const e = { ...base(), type: "client_error", props: { where: "x", message: "a".repeat(201) } };
    expect(parseClientEvent(e)).toBeNull();
  });

  it("props なしのイベントは空オブジェクト扱い", () => {
    const { props: _p, ...rest } = base();
    expect(parseClientEvent({ ...rest, type: "app_open" })?.props).toEqual({});
  });
});

describe("ingestEvents", () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  beforeEach(() => {
    ddb.reset();
    ddb.on(BatchWriteCommand).resolves({});
    ddb.on(PutCommand).resolves({});
  });
  const repo = () => new Repo(createDocClient(), "tbl");

  it("userId はサーバーで設定し、receivedAt を付与、SK は UTC", async () => {
    const e = base();
    const res = await ingestEvents(repo(), "u1", [e], new Date("2026-11-05T13:15:00Z"));
    expect(res).toEqual({ accepted: 1, dropped: 0 });
    const call = ddb.commandCalls(BatchWriteCommand)[0]!;
    const item = call.args[0].input.RequestItems!.tbl![0]!.PutRequest!.Item!;
    expect(item.PK).toBe("USER#u1");
    expect(item.SK).toBe(`EVENT#2026-11-05T13:14:03.120Z#${e.eventId}`);
    expect(item.receivedAt).toBe("2026-11-05T13:15:00.000Z");
    expect(item.timestamp).toBe(e.timestamp);
  });

  it("最大25件。超過分と不正なもの、重複 eventId は破棄", async () => {
    const dup = base();
    const events = [dup, dup, { ...base(), type: "bad" }, ...Array.from({ length: 30 }, base)];
    const res = await ingestEvents(repo(), "u1", events);
    // 先頭25件のうち dup の重複1件 + bad 1件を除いた23件
    expect(res.accepted).toBe(23);
    expect(res.dropped).toBe(events.length - 23);
    expect(ddb.commandCalls(BatchWriteCommand)[0]!.args[0].input.RequestItems!.tbl).toHaveLength(23);
  });

  it("全件不正なら書き込まない", async () => {
    await ingestEvents(repo(), "u1", [{ nope: 1 }]);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(0);
  });

  it("recordAiCall は ai_call を書き、失敗しても例外を投げない", async () => {
    await recordAiCall(
      repo(),
      { userId: "u1", bookId: "b_1", sessionId: "s_1" },
      { prompt: "P1", modelId: "m", latencyMs: 10, inputTokens: 5, outputTokens: 3, success: true, usedFallback: false },
    );
    const item = ddb.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item.type).toBe("ai_call");
    expect(item.PK).toBe("USER#u1");

    ddb.on(PutCommand).rejects(new Error("boom"));
    await expect(
      recordAiCall(repo(), { userId: "u1" }, { prompt: "P2", modelId: "m", latencyMs: 1, inputTokens: 0, outputTokens: 0, success: false, usedFallback: true }),
    ).resolves.toBeUndefined();
  });

  it("toUtcIso", () => {
    expect(toUtcIso("2026-11-05T00:00:00.000+09:00")).toBe("2026-11-04T15:00:00.000Z");
  });
});
