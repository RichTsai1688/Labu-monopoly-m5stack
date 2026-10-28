import { describe, it, expect, vi } from "vitest";
import { createNpcChat, parseNpcContext, startNpcHttpServer } from "./npc-chat";
import { npcContext } from "../src/npc-context";
import { createGame } from "../src/engine";
import { createWelcomeMessages } from "../src/companion";
describe("NPC public context and API boundary", () => {
  it("omits private channels, future RNG and secrets and grounds the NPC in its own state", () => {
    const s = createGame({ seats: 2, seed: "NEVER-SEND-SEED" });
    s.players[1].position = 12;
    s.players[1].jailTurns = 2;
    const messages = createWelcomeMessages();
    messages.push({
      id: "private",
      author: "a",
      channel: "private",
      text: "NEVER-SEND-PRIVATE",
      at: 1,
    });
    const context = npcContext(s, s.players[1].id, messages);
    expect(context.self).toContain("正在服刑");
    expect(context.speaker).toBe("Labu");
    const json = JSON.stringify(context);
    expect(json).not.toMatch(/NEVER-SEND|rngState|demo-working/);
    expect(
      parseNpcContext({ ...context, private: "discard" }),
    ).not.toHaveProperty("private");
    expect(() =>
      parseNpcContext({ ...context, events: Array(9).fill("x") }),
    ).toThrow();
  });
  it("uses Responses, disables stored responses, extracts text and caps questions per player per round", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "小城越來越熱鬧了！" }],
              },
            ],
          }),
        ),
    ) as unknown as typeof fetch;
    const chat = createNpcChat({
      apiKey: "TEST-SECRET",
      model: "test-model",
      fetcher,
    });
    const c = npcContext(createGame(), undefined, []);
    for (let i = 0; i < 10; i++)
      expect((await chat.reply(c, "Labu你好", {kind:"question",playerId:"player-0"})).source).toBe("ai");
    expect((await chat.reply(c,"Labu你好",{kind:"question",playerId:"player-0"})).source).toBe("offline");
    expect((await chat.reply({...c,round:2},"Labu你好",{kind:"question",playerId:"player-0"})).source).toBe("ai");
    const call = vi.mocked(fetcher).mock.calls[0];
    expect(call[0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(call[1]!.body as string);
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(2048);
    expect(body.input).not.toContain("TEST-SECRET");
    expect(body.tools).toBeUndefined();
    chat.close();
  });
  it("falls back on timeout and API failure and releases in-flight requests", async () => {
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Error("aborted")),
          );
        }),
    ) as typeof fetch;
    const chat = createNpcChat({
      apiKey: "test",
      model: "test",
      fetcher,
      timeoutMs: 5,
    });
    expect(
      (await chat.reply(npcContext(createGame(), undefined, []))).source,
    ).toBe("offline");
    chat.close();
    const fail = createNpcChat({
      apiKey: "test",
      model: "test",
      fetcher: async () => new Response("", { status: 429 }),
    });
    expect(
      (await fail.reply(npcContext(createGame(), undefined, []))).source,
    ).toBe("offline");
    fail.close();
  });
  it("HTTP rejects foreign origins and invalid contexts, serves only safe status", async () => {
    const service = await startNpcHttpServer(
      createNpcChat({ apiKey: "", model: "test" }),
      0,
    );
    const url = `http://127.0.0.1:${service.port}`;
    try {
      expect(await (await fetch(url + "/api/npc/status")).json()).toEqual({
        configured: false,
      });
      expect(
        (
          await fetch(url + "/api/npc/status", {
            headers: { Origin: "https://evil.example" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(url + "/api/npc/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(400);
      const r = await fetch(url + "/api/npc/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: npcContext(createGame(), undefined, []),
          text: "你好",
        }),
      });
      expect((await r.json()).source).toBe("offline");
    } finally {
      await service.close();
    }
  });
});
