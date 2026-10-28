import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { createServer } from "node:http";
import { sanitizeChatText } from "../src/companion";
import { npcFallback, type NpcContext } from "../src/npc-context";
import { replyLabu } from "./labu-ai";
import { emptyLabuMemory, type LabuMemory } from "../src/labu-policy";

export interface NpcReply {
  text: string;
  source: "ai" | "offline";
}
export interface NpcChat {
  configured: boolean;
  reply(context: NpcContext, text?: string, meta?: {gameId?:string;playerId?:string;kind?:"question"|"event"}): Promise<NpcReply>;
  close(): void;
}
export function loadNpcConfig() {
  if (process.env.LABU_DISABLE_AI === "1")
    return { apiKey: "", model: "gpt-6-luna" };
  const local = existsSync(".env")
    ? parseEnv(readFileSync(".env", "utf8"))
    : {};
  return {
    apiKey:
      process.env.OPENAI_API_KEY ||
      local.OPENAI_API_KEY ||
      local["openai_api-key"] ||
      local["openai-api-key"] ||
      "",
    model:
      process.env.OPENAI_MODEL ||
      local.OPENAI_MODEL ||
      local.openai_model ||
      "gpt-6-luna",
  };
}
/** Local adapter: bounded per-game memory; hosted rooms enforce quotas against authoritative state. */
export function createNpcChat(config: { apiKey: string; model: string; fetcher?: typeof fetch; timeoutMs?: number }): NpcChat {
  const controllers = new Set<AbortController>();
  const sessions = new Map<string, { memory: LabuMemory; counts: Map<string, number>; queue: Promise<unknown>; touched: number }>();
  let closed = false;
  return {
    configured: !!config.apiKey,
    close() { closed = true; for (const c of controllers) c.abort(); controllers.clear(); sessions.clear(); },
    async reply(context, text = "", meta = {}) {
      const key = meta.gameId ?? "local-default";
      let session = sessions.get(key);
      if (!session) {
        // Evict only idle sessions; never merge two games' memory.
        for (const [id, previous] of sessions) if (Date.now() - previous.touched > 86_400_000) sessions.delete(id);
        if (sessions.size >= 64) return { text: "Labu 正在陪好多桌玩家，請稍後再試。", source: "offline" };
        session = {memory: emptyLabuMemory(),counts:new Map(),queue:Promise.resolve(),touched:Date.now()}; sessions.set(key,session);
      }
      const currentSession = session;
      const countKey = `${meta.playerId ?? context.speaker}/${context.round}`;
      if (meta.kind === "question") {
        const count = currentSession.counts.get(countKey) ?? 0;
        if (count >= 10) return {text:"本輪已問 Labu 10 次，下輪再繼續聊吧！",source:"offline"};
        currentSession.counts.set(countKey,count+1);
      }
      currentSession.touched = Date.now();
      const operation = currentSession.queue.then(async (): Promise<NpcReply> => {
        if (closed) return {text:npcFallback(context,text),source:"offline"};
        const controller = new AbortController(); controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 25_000);
        try {
          const result = await replyLabu({...config,signal:controller.signal},{context,text,memory:currentSession.memory,author:meta.playerId ?? "玩家"});
          currentSession.memory = result.memory;
          return {text:result.text,source:result.source};
        } finally {clearTimeout(timeout);controllers.delete(controller);}
      });
      currentSession.queue = operation.catch(() => {});
      return operation;
    },
  };
}
/** Reject oversized/untyped data, then project known fields again at the trust boundary. */
export function parseNpcContext(value: unknown): NpcContext {
  if (!value || typeof value !== "object") throw Error("Invalid context");
  const c = value as Record<string, unknown>;
  const str = (v: unknown, max = 400) => {
    if (typeof v !== "string" || v.length > max) throw Error("Invalid text");
    return v;
  };
  const list = (v: unknown, max: number) => {
    if (!Array.isArray(v) || v.length > max) throw Error("Invalid list");
    return v.map((x) => str(x));
  };
  if (
    !Number.isSafeInteger(c.round) ||
    Number(c.round) < 1 ||
    Number(c.round) > 100 ||
    !Number.isSafeInteger(c.turn) ||
    Number(c.turn) < 1 ||
    Number(c.turn) > 400 ||
    !Array.isArray(c.conversation) ||
    c.conversation.length > 6
  )
    throw Error("Invalid game");
  return {
    round: Number(c.round),
    turn: Number(c.turn),
    speaker: str(c.speaker, 24),
    personality: str(c.personality, 16),
    self: str(c.self, 1000),
    standings: list(c.standings, 4),
    events: list(c.events, 8),
    market: list(c.market, 6),
    conversation: c.conversation.map((v) => ({
      author: str(v.author, 24),
      text: str(v.text, 16000),
    })),
  };
}
export async function startNpcHttpServer(chat: NpcChat, port = 5175) {
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (
          !["localhost", "127.0.0.1", "[::1]"].includes(
            new URL(origin).hostname,
          )
        ) {
          res.writeHead(403).end();
          return;
        }
      } catch {
        res.writeHead(403).end();
        return;
      }
    }
    if (req.method === "GET" && req.url === "/api/npc/status") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ configured: chat.configured }));
      return;
    }
    if (
      req.method !== "POST" ||
      req.url !== "/api/npc/chat" ||
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      res.writeHead(404).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 150000) {
          res.writeHead(413).end();
          return;
        }
      }
      const raw = JSON.parse(body);
      const context = parseNpcContext(raw.context);
      if (typeof raw.text !== "string" || raw.text.length > 560)
        throw Error("Invalid message");
      const gameId = typeof raw.gameId === "string" && raw.gameId.length <= 100 ? raw.gameId : "local-default";
      const playerId = typeof raw.playerId === "string" && raw.playerId.length <= 32 ? raw.playerId : "local-player";
      const kind = raw.kind === "event" ? "event" : "question";
      const result = await chat.reply(context, sanitizeChatText(raw.text), {gameId,playerId,kind});
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400).end("Invalid chat request");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : port,
    close: async () => {
      chat.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
