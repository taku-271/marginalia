import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { keys, type Book, type ReadingNote, type ReadingSession } from "./model.js";

export type Doc = DynamoDBDocumentClient;

export function createDocClient(): Doc {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/** 内部キー(PK/SK)を除いて返す */
function strip<T>(item: Record<string, unknown> | undefined): T | undefined {
  if (!item) return undefined;
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as T;
}

export async function queryAll(doc: Doc, input: QueryCommandInput) {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export class Repo {
  constructor(
    private readonly doc: Doc,
    private readonly table: string,
  ) {}

  async putBook(userId: string, book: Book) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: keys.pk(userId), SK: keys.book(book.bookId), ...book },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  }

  async getBook(userId: string, bookId: string): Promise<Book | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: keys.pk(userId), SK: keys.book(bookId) } }),
    );
    return strip<Book>(res.Item);
  }

  async listBooks(userId: string): Promise<Book[]> {
    const items = await queryAll(this.doc, {
      TableName: this.table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": keys.pk(userId), ":sk": "BOOK#" },
    });
    return items.map((i) => strip<Book>(i)!);
  }

  async markBookFinished(userId: string, bookId: string, finishedAt: string) {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: keys.pk(userId), SK: keys.book(bookId) },
        UpdateExpression: "SET finishedAt = if_not_exists(finishedAt, :f)",
        ExpressionAttributeValues: { ":f": finishedAt },
      }),
    );
  }

  /** その本の全セッション(古い順) */
  async listSessions(userId: string, bookId: string): Promise<ReadingSession[]> {
    const items = await queryAll(this.doc, {
      TableName: this.table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": keys.pk(userId), ":sk": keys.sessionPrefix(bookId) },
      ScanIndexForward: true,
    });
    return items.map((i) => strip<ReadingSession>(i)!);
  }

  async putSession(userId: string, s: ReadingSession) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: keys.pk(userId), SK: keys.session(s.bookId, s.startedAt, s.sessionId), ...s },
      }),
    );
  }

  /** 指定した属性だけを更新する(undefined は REMOVE)。同時に別の操作が走っても他の属性を消さない */
  async updateSession(userId: string, s: ReadingSession, patch: Partial<ReadingSession>) {
    const sets: string[] = [];
    const removes: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    Object.entries(patch).forEach(([k, v], i) => {
      names[`#k${i}`] = k;
      if (v === undefined) removes.push(`#k${i}`);
      else {
        sets.push(`#k${i} = :v${i}`);
        values[`:v${i}`] = v;
      }
    });
    if (!sets.length && !removes.length) return;
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: keys.pk(userId), SK: keys.session(s.bookId, s.startedAt, s.sessionId) },
        UpdateExpression: [sets.length ? `SET ${sets.join(", ")}` : "", removes.length ? `REMOVE ${removes.join(", ")}` : ""]
          .filter(Boolean)
          .join(" "),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ConditionExpression: "attribute_exists(PK)",
      }),
    );
  }

  /** セッション(1回分の問い・回答・メモ)を削除する。存在しなければ ConditionalCheckFailedException */
  async deleteSession(userId: string, s: ReadingSession) {
    await this.doc.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { PK: keys.pk(userId), SK: keys.session(s.bookId, s.startedAt, s.sessionId) },
        ConditionExpression: "attribute_exists(PK)",
      }),
    );
  }

  async findSession(userId: string, bookId: string, sessionId: string) {
    const sessions = await this.listSessions(userId, bookId);
    const index = sessions.findIndex((s) => s.sessionId === sessionId);
    return index < 0 ? undefined : { session: sessions[index]!, previous: sessions.slice(0, index) };
  }

  async getNote(userId: string, bookId: string): Promise<ReadingNote | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: keys.pk(userId), SK: keys.note(bookId) } }),
    );
    return strip<ReadingNote>(res.Item);
  }

  /** 再生成時は上書き */
  async putNote(userId: string, note: ReadingNote) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: keys.pk(userId), SK: keys.note(note.bookId), ...note },
      }),
    );
  }

  /**
   * BatchWriteItem(最大25件)。UnprocessedItems は数回だけ再試行する。
   */
  async batchPut(items: Record<string, unknown>[]) {
    if (items.length === 0) return;
    if (items.length > 25) throw new Error("batchPut accepts at most 25 items");
    let requests = items.map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; attempt < 4 && requests.length > 0; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const res = await this.doc.send(
        new BatchWriteCommand({ RequestItems: { [this.table]: requests } }),
      );
      requests = (res.UnprocessedItems?.[this.table] ?? []) as typeof requests;
    }
    if (requests.length > 0) {
      console.warn(`batchPut: ${requests.length} items left unprocessed`);
    }
  }

  async putItem(item: Record<string, unknown>) {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
  }
}
