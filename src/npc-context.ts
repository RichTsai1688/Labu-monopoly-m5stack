import { gameCalendar, stockQuote } from "./calendar";
import { formatMoney, getNetWorth, VEHICLES, BANK_POSITIONS } from "./engine";
import type { GameState } from "./game-types";
import type { ChatMessage } from "./companion";
import { sanitizeChatText } from "./companion";

export interface NpcContext {
  round: number;
  turn: number;
  speaker: string;
  personality: string;
  self: string;
  standings: string[];
  events: string[];
  market: string[];
  conversation: { author: string; text: string }[];
}
/** Explicit public-data projection. Never send seed, RNG, private chat or reminders. */
export function npcContext(
  s: GameState,
  speakerId: string | undefined,
  messages: readonly ChatMessage[],
): NpcContext {
  const p = s.players.find((p) => p.id === speakerId);
  return {
    round: s.round,
    turn: s.turn,
    speaker: p?.name ?? "Labu",
    personality: p?.personality ?? "balanced",
    self: p
      ? `第${gameCalendar(s.round).year}年${gameCalendar(s.round).season}季，${p.name}在${s.tiles[p.position].name}，現金${formatMoney(p.cash)}、存款${formatMoney(p.deposit)}，${p.jailTurns ? `正在服刑，剩餘${p.jailTurns}輪` : "自由行動"}，交通工具${VEHICLES.find((v) => v.id === p.vehicleId)?.name ?? "步行"}，自己的地產：${
          s.tiles
            .filter((t) => t.ownerId === p.id)
            .map((t) => `${t.name} ${t.level}級`)
            .join("、") || "尚無"
        }`
      : "Labu 是城市陪玩助手，沒有玩家席位，不可聲稱自己擲骰或付租。",
    standings: s.players.map(
      (p) =>
        `${p.name}：${p.bankrupt ? "破產" : formatMoney(getNetWorth(s, p))}，位置${s.tiles[p.position].name}；現金${formatMoney(p.cash)}、存款${formatMoney(p.deposit)}；前方銀行相距${Math.min(...BANK_POSITIONS.map(b => (b - p.position + 48) % 48 || 48))}格`,
    ),
    events: s.log.slice(-8).map((l) => l.text),
    market: s.stocks.map(
      (st) =>
        `${st.name} ${stockQuote(st.price)}，較上一步${st.price - st.previousPrice >= 0 ? "+" : ""}${st.price - st.previousPrice} 元／股`,
    ),
    conversation: messages
      .filter((m) => m.channel === "table")
      .slice(-6)
      .map((m) => ({ author: m.author, text: m.text })),
  };
}
export function npcFallback(context: NpcContext, text = ""): string {
  if (/待辦|提醒|訊息|郵件/.test(text))
    return "我目前只看得到這局遊戲，尚未連到你的真實訊息或待辦；私人提醒仍是示範資料。";
  return sanitizeChatText(
    `${context.events.at(-1) ?? `現在是第 ${context.round} 輪。`} 我會留意現金和接下來的地產，慢慢把小城蓋起來！`,
  );
}
