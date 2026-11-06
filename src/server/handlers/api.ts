import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { EventsRequest } from "../../shared/events.js";
import { createBedrockLlm } from "../ai/bedrock.js";
import { NoteGenerationError } from "../ai/generate.js";
import { createApp, HttpError, type App } from "../app.js";
import { createCognitoVerifier, type VerifyIdToken } from "../auth.js";
import { getConfig } from "../config.js";
import { createDocClient, Repo } from "../db/repo.js";
import { ingestEvents } from "../events/ingest.js";

type Result = APIGatewayProxyStructuredResultV2;

export interface HandlerDeps {
  app: App;
  repo: Repo;
  verify: VerifyIdToken;
}

const json = (statusCode: number, body: unknown): Result => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});
const noContent: Result = { statusCode: 204 };

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new HttpError(400, "invalid JSON body");
}

const ID = "([A-Za-z0-9_-]+)";
type Route = {
  method: string;
  pattern: RegExp;
  run: (d: HandlerDeps, userId: string, params: string[], body: Record<string, unknown>) => Promise<Result>;
};

const routes: Route[] = [
  {
    method: "POST",
    pattern: /^\/api\/events$/,
    run: async ({ repo }, userId, _p, body) => {
      const parsed = EventsRequest.safeParse(body);
      if (!parsed.success) throw new HttpError(400, "events must be an array");
      await ingestEvents(repo, userId, parsed.data.events);
      return noContent;
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/books$/,
    run: async ({ app }, userId) => json(200, { books: await app.listBooks(userId) }),
  },
  {
    method: "GET",
    pattern: new RegExp(`^/api/books/${ID}$`),
    run: async ({ app }, userId, [bookId]) => json(200, await app.getBook(userId, bookId!)),
  },
  {
    method: "POST",
    pattern: /^\/api\/books$/,
    run: async ({ app }, userId, _p, body) => json(201, await app.createBook(userId, body)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/sessions$`),
    run: async ({ app }, userId, [bookId]) => json(201, await app.startReading(userId, bookId!)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/sessions/${ID}/end$`),
    run: async ({ app }, userId, [bookId, sessionId]) =>
      json(200, await app.endReading(userId, bookId!, sessionId!)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/sessions/${ID}/answer$`),
    run: async ({ app }, userId, [bookId, sessionId], body) =>
      json(200, await app.submitAnswer(userId, bookId!, sessionId!, body)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/sessions/${ID}/skip$`),
    run: async ({ app }, userId, [bookId, sessionId]) => {
      await app.skipQuestion(userId, bookId!, sessionId!);
      return noContent;
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/sessions/${ID}/free-note$`),
    run: async ({ app }, userId, [bookId, sessionId], body) => {
      await app.submitFreeNote(userId, bookId!, sessionId!, body);
      return noContent;
    },
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/sessions/${ID}/memos$`),
    run: async ({ app }, userId, [bookId, sessionId], body) =>
      json(201, await app.addMemo(userId, bookId!, sessionId!, body)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/finish$`),
    run: async ({ app }, userId, [bookId]) => json(200, await app.finishBook(userId, bookId!)),
  },
  {
    method: "POST",
    pattern: new RegExp(`^/api/books/${ID}/note/regenerate$`),
    run: async ({ app }, userId, [bookId]) => json(200, await app.regenerateNote(userId, bookId!)),
  },
  {
    method: "GET",
    pattern: new RegExp(`^/api/books/${ID}/note$`),
    run: async ({ app }, userId, [bookId]) => json(200, await app.getNote(userId, bookId!)),
  },
];

export function createHandler(deps: HandlerDeps) {
  return async (event: APIGatewayProxyEventV2): Promise<Result> => {
    try {
      const method = event.requestContext.http.method;
      const path = event.rawPath;
      let matched: { route: Route; params: string[] } | undefined;
      for (const route of routes) {
        const m = route.pattern.exec(path);
        if (m && route.method === method) {
          matched = { route, params: m.slice(1) };
          break;
        }
      }
      if (!matched) return json(404, { error: "not found" });

      const token = event.headers["x-id-token"];
      if (!token) return json(401, { error: "missing X-Id-Token" });
      let userId: string;
      try {
        userId = await deps.verify(token);
      } catch {
        return json(401, { error: "invalid token" });
      }

      return await matched.route.run(deps, userId, matched.params, parseBody(event));
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof NoteGenerationError) return json(502, { error: "note generation failed" });
      console.error(err);
      return json(500, { error: "internal error" });
    }
  };
}

let cached: ReturnType<typeof createHandler> | undefined;

/** Lambda エントリポイント */
export const handler = async (event: APIGatewayProxyEventV2) => {
  if (!cached) {
    const config = getConfig();
    const repo = new Repo(createDocClient(), config.tableName);
    const llm = createBedrockLlm(new BedrockRuntimeClient({ region: config.bedrockRegion }));
    cached = createHandler({
      app: createApp({ repo, llm, config }),
      repo,
      verify: createCognitoVerifier(config.userPoolId, config.userPoolClientId),
    });
  }
  return cached(event);
};
