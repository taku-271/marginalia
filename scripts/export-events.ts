/**
 * 指定期間のイベントとセッションを JSONL に書き出す(Claude に渡して分析する用)。
 *
 *   bun run export-events --from 2026-11-01 --to 2026-11-30 [--user <userId>] [--table <name>] [--out ./export] [--profile <name>]
 *
 * - AWS の認証は名前付きプロファイル(既定 marginalia。--profile か環境変数 AWS_PROFILE で変更)
 *
 * - 日付は日本時間(Asia/Tokyo)の日付として解釈し、--to の日の終わりまでを含む
 * - --user 省略時はテーブル全体を Scan して全ユーザー分を出す(MVP の少人数利用を想定)
 * - 出力: <out>/events.jsonl, <out>/sessions.jsonl(各行に userId を付ける。PK/SK は落とす)
 * - セッションは本文(問い・回答・自由入力)を含む。取り扱いに注意
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ScanCommand, type ScanCommandInput } from "@aws-sdk/lib-dynamodb";
import { createDocClient, queryAll, type Doc } from "../src/server/db/repo.js";

export function jstRange(from: string, to: string) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) throw new Error("--from/--to must be YYYY-MM-DD");
  const start = new Date(`${from}T00:00:00.000+09:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00.000+09:00`).getTime() + 86_400_000 - 1).toISOString();
  return { start, end };
}

type Item = Record<string, unknown>;

function userIdOf(pk: unknown) {
  return typeof pk === "string" ? pk.replace(/^USER#/, "") : undefined;
}

export function toRow(item: Item): Item {
  const { PK, SK: _sk, ...rest } = item;
  return { userId: userIdOf(PK), ...rest };
}

export function inRange(iso: unknown, start: string, end: string) {
  if (typeof iso !== "string") return false;
  const t = new Date(iso).toISOString();
  return t >= start && t <= end;
}

async function scanAll(doc: Doc, input: ScanCommandInput) {
  const items: Item[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const res = await doc.send(new ScanCommand({ ...input, ExclusiveStartKey }));
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      to: { type: "string" },
      user: { type: "string" },
      table: { type: "string" },
      out: { type: "string", default: "./export" },
      profile: { type: "string" },
    },
  });
  // SDK はクライアント作成後の認証解決時に AWS_PROFILE を読む
  process.env.AWS_PROFILE = values.profile ?? process.env.AWS_PROFILE ?? "marginalia";
  process.env.AWS_REGION ??= "ap-northeast-1";
  const table = values.table ?? process.env.TABLE_NAME;
  if (!table || !values.from || !values.to) {
    console.error("usage: export-events --from YYYY-MM-DD --to YYYY-MM-DD [--user id] [--table name] [--out dir] [--profile name]");
    process.exit(1);
  }
  const { start, end } = jstRange(values.from, values.to);
  const doc = createDocClient();

  let events: Item[];
  let sessions: Item[];
  if (values.user) {
    const pk = `USER#${values.user}`;
    events = await queryAll(doc, {
      TableName: table,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :a AND :b",
      ExpressionAttributeValues: { ":pk": pk, ":a": `EVENT#${start}`, ":b": `EVENT#${end}~` },
    });
    sessions = await queryAll(doc, {
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :s)",
      ExpressionAttributeValues: { ":pk": pk, ":s": "SESSION#" },
    });
  } else {
    events = await scanAll(doc, {
      TableName: table,
      FilterExpression: "SK BETWEEN :a AND :b",
      ExpressionAttributeValues: { ":a": `EVENT#${start}`, ":b": `EVENT#${end}~` },
    });
    sessions = await scanAll(doc, {
      TableName: table,
      FilterExpression: "begins_with(SK, :s)",
      ExpressionAttributeValues: { ":s": "SESSION#" },
    });
  }
  sessions = sessions.filter((s) => inRange(s.startedAt, start, end));

  const byTime = (k: string) => (a: Item, b: Item) => String(a[k]).localeCompare(String(b[k]));
  const eventRows = events
    .map(toRow)
    .sort((a, b) => new Date(String(a.timestamp)).getTime() - new Date(String(b.timestamp)).getTime());
  const sessionRows = sessions.map(toRow).sort(byTime("startedAt"));

  await mkdir(values.out!, { recursive: true });
  const jsonl = (rows: Item[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  await writeFile(join(values.out!, "events.jsonl"), jsonl(eventRows));
  await writeFile(join(values.out!, "sessions.jsonl"), jsonl(sessionRows));
  console.log(
    `wrote ${eventRows.length} events and ${sessionRows.length} sessions (${start} – ${end}) to ${values.out}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
