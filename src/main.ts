import { renderMoneyFeedback, popupFeedback, disposeFeedback } from "./feedback";
import { DICE_MOVE_DELAY_MS } from "./presentation-timing";
const hostedTrial = import.meta.env.MODE === "sites";
const invitedRoom = (new URLSearchParams(location.search).get('room') || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
import { gameCalendar, stockQuote, DIVIDENDS, SEASONS } from "./calendar";
import { npcContext, npcFallback } from "./npc-context";
import { shouldAskLabu } from "./labu-policy";
import vehicle0Preview from "./assets/vehicles/bicycle.png";
import vehicle1Preview from "./assets/vehicles/scooter.png";
import vehicle2Preview from "./assets/vehicles/city-car.png";
import vehicle3Preview from "./assets/vehicles/tesla-model-3.png";
import vehicle4Preview from "./assets/vehicles/tesla-model-y.png";
const vehiclePreviews: Record<string, string> = {
  bicycle: vehicle0Preview,
  scooter: vehicle1Preview,
  "city-car": vehicle2Preview,
  "tesla-model-3": vehicle3Preview,
  "tesla-model-y": vehicle4Preview,
};
import "./style.css";
import eventAtlas from "./assets/art/events-atlas.webp";
import { eventPresentation } from "./event-presentation";
import { cardArt, cardSummaries } from "./card-art";
import logoArt from "./assets/art/logo.webp";
import bankArt from "./assets/art/bank.webp";
import townhouseArt from "./assets/art/townhouse.webp";
import bearPortrait from "./assets/bear.webp";
import rabbitPortrait from "./assets/rabbit.webp";
import robotPortrait from "./assets/robot.webp";
import penguinPortrait from "./assets/penguin.webp";
import { RoomClient, type RoomSnapshot, type RoomSession } from "./network";
import {
  createGame,
  dispatch,
  getNpcAction,
  formatMoney,
  getNetWorth,
  serializeGame,
  deserializeGame,
  VEHICLES,
  getDiceCount,
  getRent,
  getUpgradeCost,
  ownsDistrict,
  DISTRICT_NAMES,
  CITY_GOALS,
  goalProgress,
  CARD_PRICES,
  CARD_DESCRIPTIONS,
  ATTACK_CARDS,
  HAND_LIMIT,
  BAIL_COST,
  getRankings,
} from "./engine";
import type { GameState, GameAction, Card } from "./game-types";
import { ToyCity } from "./city";
import { GameAudio } from "./audio";
import { GameMusic } from "./music";
import musicUrl from "./assets/audio/toy-city.mp3?url";
import { CityModelAssets } from "./model-assets";
import {
  createWelcomeMessages,
  replyAsLabu,
  getDemoReminders,
  sanitizeChatText,
  type ChatMessage,
} from "./companion";

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (name: string) =>
  ({
    bank: "▥",
    stock: "↗",
    home: "⌂",
    chat: "☏",
    map: "▦",
    settings: "⚙",
    coin: "◉",
    dice: "⚄",
    close: "×",
    back: "←",
    card: "▤",
  })[name] || "◇";
const avatar = ["🐻", "🐰", "🤖", "🐧"];
const portraits = [
  bearPortrait,
  rabbitPortrait,
  robotPortrait,
  penguinPortrait,
];
const themeNames: Record<string, string> = {
  candy: "糖果童話",
  space: "太空科技",
  forest: "森林花園",
  harbor: "海港積木",
};
const typeNames: Record<string, string> = {
  property: "地產",
  bank: "玩具銀行",
  start: "市政廣場",
  prison: "監獄",
  police: "警察局",
  station: "車站",
  shop: "道具商店",
  event: "機會廣場",
  park: "公園",
  tax: "稅務局",
  amusement: "遊樂園",
  auction: "拍賣中心",
  construction: "建設中心",
};
const cardNames: Record<string, string> = {
  loadedDice: "指定骰",
  rentShield: "免租券",
  jailFree: "出獄卡",
  renovation: "遠端建設卡",
  wanted: "🚓 通緝令",
  steal: "🦝 小偷卡",
  roadblock: "🚧 路障卡",
  trap: "🪤 整人陷阱",
  shutdown: "🛑 暫停營業卡",
  swap: "🔄 換位卡",
  bodyguard: "🛡️ 保鑣卡",
};
const SAVE_KEY = "labu-toy-city-v1";
let state: GameState = createGame({
  seed: Date.now(),
  seats: 4,
  humanNames: ["你"],
  maxRounds: 12,
});
let started = false,
  paused = false,
  fast = false,
  muted = true,
  timer: ReturnType<typeof setTimeout> | undefined;
let city: ToyCity | undefined;
let modelAssets: CityModelAssets | undefined;
let panelTab = "chat",
  chatTab = "table";
const chatDrafts: Record<string, string> = { table: "", private: "" };
let askLabuMode = false;
const labuUsage = new Map<string, number>();
let labuQueue: Promise<unknown> = Promise.resolve();
let labuPending = 0;
const localSpeaker = () => state.players.find((p) => !p.isNpc && p.id === current().id) || state.players.find((p) => !p.isNpc) || current();
const labuUsageKey = () => `${state.seed}:${state.round}:${localSpeaker().id}`;
let messages: ChatMessage[] = createWelcomeMessages();
let reminderDismissed = new Set<string>();
let roomClient: RoomClient | null = null,
  room: RoomSnapshot | null = null,
  roomSession: RoomSession | null = null,
  networkConnected = false;
let offlineBeforeRoom: {
  state: GameState;
  started: boolean;
  paused: boolean;
} | null = null;
let saveFailed = false,
  lastFocus: HTMLElement | null = null,
  modalRevision = 0;
const audio = new GameAudio();
const music = new GameMusic(musicUrl);
const app = $("#app");
app.innerHTML = `
<header class="app-header"><a class="brand" href="#" aria-label="玩具城市首頁"><div class="toy-logo"><img class="brand-logo" src="${logoArt}" alt="玩具城市"><small>48 格環城線 · LABU</small></div></a><button class="calendar-badge" id="round" aria-label="遊戲日曆"></button><div class="header-center"><span class="status-dot"></span> ${hostedTrial ? "線上玩具城市" : "本機離線版"} <span class="divider">/</span> 和朋友，蓋一座夢想城市</div><div class="header-actions"><details id="finance-menu"><summary class="icon-button" aria-label="提款卡與股票交易">💳</summary><div class="finance-menu-options"><button id="mobile-market">股票買進／賣出</button><button id="mobile-bank">💳 提款卡 · 存款／提款</button></div></details><button class="text-button invite-button" id="room-open">邀請好友</button><button class="icon-button" id="sound" title="開啟音效" aria-label="開啟音效">♪</button><button class="icon-button" id="help" title="遊戲規則" aria-label="遊戲規則">?</button><button class="icon-button" id="garage-launch" aria-label="車庫與買車" title="車庫與買車">🚘</button><button class="icon-button chat-launch" id="chat-launch" aria-label="開啟聊天" aria-expanded="false" title="同桌聊天">💬<span id="chat-unread" hidden>❗️</span></button><button class="text-button" id="settings">設定</button></div></header>
<section id="players" class="player-strip" aria-label="玩家資產"></section>
<main class="game-layout"><section class="world-panel"><div class="world-heading"><div><span class="eyebrow">BUILD A LITTLE WONDER</span><h1>你的城市，你的冒險<span>。</span></h1></div></div><div id="world" aria-label="48格玩具城市3D棋盤"><div class="world-loading">正在組裝玩具城市…</div></div><div class="world-tools"><details id="view-menu" class="view-menu"><summary class="glass-button">🗺 視角</summary><div class="view-options"><button id="reset-view" class="glass-button">${icon("map")} 全圖</button><button id="follow-view" class="glass-button">角色近景</button><button id="board-list" class="glass-button">48 格地圖</button></div></details><span class="world-hint">拖曳旋轉 · 滾輪縮放 · 點選地塊</span></div><div id="dice-reveal" class="dice-reveal" role="status" hidden></div><section id="public-events" class="public-events" aria-label="公開遊戲事件" aria-live="polite"></section><div id="turn-card" class="turn-card"></div></section>
<aside class="side-panel" aria-label="城市與聊天選單"><nav class="side-tabs"><button data-panel="chat" class="active">同桌聊天 <span class="tiny-dot"></span></button><button id="side-collapse" aria-expanded="false" aria-controls="side-content" aria-label="展開城市與聊天選單">⌃</button></nav><div id="side-content"></div></aside></main>
<footer class="market-bar"><div class="market-title"><span class="market-icon">↗</span><div><strong>玩具交易所</strong><small id="tick-label">每走一格，全市場更新</small></div></div><div id="ticker" class="ticker"></div><button id="market-open" class="market-more" aria-label="查看股票行情">全部行情 ↗</button></footer>
<aside id="housing-notice" hidden></aside><div id="toast" role="status" class="toast"></div>
<dialog id="modal" class="modal"><div id="modal-body"></div></dialog>
<div id="lobby" class="lobby-layer"></div>`;

function current() {
  return state.players[state.currentPlayer];
}
function money(v: number) {
  return formatMoney(v);
}
function diceMarkup(value: number) {
  const pips: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return `<span class="dice-cube" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<i class="${pips[value].includes(i) ? "pip-on" : ""}"></i>`).join("")}</span>`;
}
function canAct() {
  return (
    started &&
    !paused &&
    !current().isNpc &&
    state.phase !== "moving" &&
    state.phase !== "finished" &&
    (!roomClient ||
      (networkConnected &&
        room?.selfId === current().id &&
        !room.pendingReclaim))
  );
}
function save() {
  if (!started || roomClient) return;
  try {
    localStorage.setItem(SAVE_KEY, serializeGame(state));
    saveFailed = false;
  } catch {
    if (!saveFailed)
      toast("無法儲存：儲存空間不足或瀏覽器限制。可由設定匯出存檔。");
    saveFailed = true;
  }
}
function toast(text: string) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("visible");
  window.clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(
    window.setTimeout(() => el.classList.remove("visible"), 3200),
  );
}
function showModal(html: string, wide = false) {
  modalRevision++;
  lastFocus = document.activeElement as HTMLElement;
  const d = $<HTMLDialogElement>("#modal");
  d.classList.toggle("wide", wide);
  $("#modal-body").innerHTML =
    `<button class="modal-close" aria-label="關閉視窗">×</button>${html}`;
  if (!d.open) { d.showModal(); popupFeedback($("#modal-body"), `modal:${modalRevision}`); }
  $(".modal-close").onclick = closeModal;
}
function closeModal() {
  modalRevision++;
  $<HTMLDialogElement>("#modal").close();
  lastFocus?.focus();
}
function modalHeader(kicker: string, title: string, sub = "") {
  const illustratedCard = Object.keys(cardNames).find(id => cardNames[id] === title);
  return `${illustratedCard ? cardArt(illustratedCard) : ""}<span class="eyebrow">${kicker}</span><h2>${title}</h2>${sub ? `<p class="modal-sub">${sub}</p>` : ""}`;
}
function updateCity() {
  city?.update({
    stepDuration: fast ? 110 : 420,
    season: gameCalendar(state.round).seasonIndex,
    tiles: state.tiles.map((t) => ({
      id: t.id,
      type: t.type,
      name: t.name,
      owner:
        t.ownerId === null
          ? null
          : state.players.findIndex((p) => p.id === t.ownerId),
      level: t.level,
      effect: state.hazards?.find(h => h.tileId === t.id && h.expiresTurn > state.turn)?.kind ?? ((t.closedUntilTurn ?? 0) > state.turn ? "shutdown" : undefined),
    })),
    players: state.players.map((p, i) => ({
      id: i,
      position: p.position,
      theme: p.theme,
      color: p.color,
      bankrupt: p.bankrupt,
      vehicleId: p.vehicleId,
    })),
    currentPlayer: state.currentPlayer,
  });
}
function render() {
  $(".header-center").innerHTML = roomClient
    ? `<span class="status-dot"></span> ${networkConnected ? (hostedTrial ? "線上朋友房" : "本機連線房間") : "連線中斷"} · ${esc(room?.code || "")} <span class="divider">/</span> ${room?.pendingReclaim ? "NPC 完成本回合後接回" : "伺服器同步"}`
    : `<span class="status-dot"></span> ${hostedTrial ? "線上玩具城市" : "本機離線版"} <span class="divider">/</span> 和朋友，蓋一座夢想城市`;
  $("#players").innerHTML = state.players
    .map(
      (p, i) =>
        `<button class="player-card ${i === state.currentPlayer ? "current" : ""} ${p.bankrupt ? "bankrupt" : ""}" data-player="${i}" style="--player-color:${p.color}"><span class="avatar"><img src="${portraits[i]}" alt="${["小熊", "兔兔", "Labu 機器人", "企鵝"][i]}" draggable="false"></span><span class="player-details"><span class="player-name"><small>${p.isNpc ? "NPC" : `${i + 1}P`}</small> ${esc(p.name)}</span><strong>${money(p.cash)}</strong><span class="player-meta">${themeNames[p.theme]} · 地產 ${state.tiles.filter((t) => t.ownerId === p.id).length}</span></span>${i === state.currentPlayer ? '<span class="turn-tag">目前回合</span>' : ""}</button>`,
    )
    .join("");
  document
    .querySelectorAll<HTMLElement>("[data-player]")
    .forEach(
      (el) => (el.onclick = () => showAssets(Number(el.dataset.player))),
    );
  const calendar = gameCalendar(state.round);
  $("#round").innerHTML = `<span aria-hidden="true">📅</span><small>${calendar.season} · ${state.round}/${state.maxRounds}</small>`;
  $("#round").setAttribute("aria-label", `遊戲日曆：第 ${calendar.year} 年 ${calendar.season}季，第 ${state.round}／${state.maxRounds} 回合`);
  $("#round").onclick = () => showModal(modalHeader("📅 城市日曆", "季節與遊戲進度") + `<p>第 ${calendar.year} 年 · ${calendar.season}季 ${calendar.roundInSeason}/2</p><p>目前第 <strong>${state.round}</strong> 回合，全局共 ${state.maxRounds} 回合。</p>`);
  $("#tick-label").textContent = `每走一格更新 · 已更新 ${state.marketTick} 次`;
  $("#ticker").innerHTML = state.stocks
    .map((s) => {
      const diff = s.price - s.previousPrice;
      return `<button class="stock-tick" data-stock="${s.id}"><span>${esc(s.name)}</span><strong>${stockQuote(s.price)}</strong><small class="${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "▲" : "▼"} ${Math.abs((diff / s.previousPrice) * 100).toFixed(1)}%</small></button>`;
    })
    .join("");
  document
    .querySelectorAll<HTMLElement>("[data-stock]")
    .forEach((el) => (el.onclick = () => showMarket(el.dataset.stock)));
  renderTurn();
  renderSide();
  updateCity();
  renderPublicEvents();
  renderDiceReveal();
  renderMoneyFeedback(state, kind => audio.play(kind), room?.selfId);
  renderHousingNotice();
  $("#mobile-bank").textContent = `💳 存款／提款 · 剩 ${3-(financePlayer().mobileBankUses ?? 0)} 次`;

}
let dismissedHousing = '';
function renderHousingNotice() {
  const report=state.propertyReport, el=$("#housing-notice");
  const key=`${state.seed}:${report?.round}`;
  if(!report || dismissedHousing===key || state.phase!=='roll') {el.hidden=true;return;}
  el.hidden=false;
  el.innerHTML=`<button id="housing-close" class="arrival-close" aria-label="關閉房市通知">×</button><span class="housing-art event-art" role="img" aria-label="房市街屋插圖" style="background-image:url('${eventAtlas}');background-position:66.6667% 0%"></span><h3>🏘️ 第 ${report.round} 回合 · 房市新行情</h3><p>地產售價、資產估值與租金同步調整</p><div class="housing-rates">${report.changes.map(c=>`<span>${esc(DISTRICT_NAMES[c.district])} <b class="${c.percent>0?'up':'down'}">${c.percent>0?'▲ +':'▼ '}${c.percent}%</b></span>`).join('')}</div>`;
  $("#housing-close").onclick=()=>{dismissedHousing=key;el.hidden=true;};
}
let publicEventKey = "";
let dismissedPublicEvent = "";
function renderPublicEvents() {
  const p = current();
  const recent = state.log.slice(-6);
  const financial = [...recent].reverse().find(l => /萬元/.test(l.text));
  const selected = [...new Map([...recent.slice(-2), ...(financial ? [financial] : [])].map(l=>[l.id,l])).values()].sort((a,b)=>a.id-b.id);
  const key = `${state.seed}:${selected.map(l=>l.id).join()}`;
  const status = state.phase === "moving" ? `${p.name} 前進中 · 還有 ${state.pendingSteps} 格` : state.phase === "roll" ? `輪到 ${p.name} · ${p.isNpc ? "NPC 思考中" : "等待擲骰"}` : state.phase === "finished" ? "本局已結束" : `${p.name} 正在選擇操作`;
  if (key === publicEventKey) { $("#public-events .public-status").textContent = status; return; }
  publicEventKey = key;
  const headline = [...selected].reverse().find(l => !/擲出|抵達/.test(l.text)) || selected.at(-1);
  const eventKey = `${state.seed}:${headline?.id || 0}`;
  const look = eventPresentation(headline?.text || "");
  const body = headline ? esc(headline.text).replace(/([\d,.]+\s*萬元)/g,'<b>$1</b>') : "準備出發！";
  $("#public-events").innerHTML = `<strong class="public-status">${esc(status)}</strong><article class="illustrated-event" role="button" tabindex="0" aria-label="關閉城市動態卡" data-event-id="${headline?.id || 0}"><span class="event-art" role="img" aria-label="${look.title}插圖" style="background-image:url('${eventAtlas}');background-position:${(look.cell % 4) * 100/3}% ${Math.floor(look.cell / 4)*50}%"></span><div><h3>${look.title}</h3><p>${body}</p></div><span class="event-dismiss" aria-hidden="true">×</span></article>${selected.filter(l=>l.id!==headline?.id && /萬元/.test(l.text)).map(l=>`<p class="event-receipt">${esc(l.text).replace(/([\d,.]+\s*萬元)/g,'<b>$1</b>')}</p>`).join("")}`;
  const eventCard = $("#public-events .illustrated-event");
  const dismiss = () => {
    dismissedPublicEvent = eventKey;
    $("#public-events").classList.add("event-dismissed");
  };
  $("#public-events").classList.toggle("event-dismissed", dismissedPublicEvent === eventKey);
  eventCard.onclick = dismiss;
  eventCard.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); dismiss(); }
  };
}
let diceRevealKey = "";
let diceRevealTimer: ReturnType<typeof setTimeout> | undefined;
let diceShuffleTimer: ReturnType<typeof setInterval> | undefined;
function renderDiceReveal() {
  if (!["moving", "action"].includes(state.phase) || !state.dice.length) return;
  const key = `${state.seed}:${state.turn}:${state.currentPlayer}:${state.dice.join()}`;
  if (key === diceRevealKey) return;
  diceRevealKey = key;
  audio.play("roll");
  clearTimeout(diceRevealTimer);
  clearInterval(diceShuffleTimer);
  const el = $("#dice-reveal");
  el.hidden = false;
  el.innerHTML = `<span>${esc(current().name)} 擲骰！</span><div class="dice-tumble">${state.dice.map(diceMarkup).join("")}</div><strong class="dice-result">${state.dice.join(' ＋ ')} ＝ ${state.die} 格</strong>`;
  const finalDice = [...state.dice];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducedMotion) {
    const started = performance.now();
    diceShuffleTimer = setInterval(() => {
      const settled = performance.now() - started >= 2200;
      el.querySelectorAll(".dice-cube").forEach((cube, i) => {
        const value = settled ? finalDice[i] : 1 + Math.floor(Math.random() * 6);
        cube.innerHTML = diceMarkup(value).replace(/^<span[^>]*>|<\/span>$/g, "");
      });
      if (settled) clearInterval(diceShuffleTimer);
    }, 90);
  }
  diceRevealTimer = setTimeout(() => { clearInterval(diceShuffleTimer); el.hidden = true; el.innerHTML = ""; }, reducedMotion ? 1800 : 3600);
}
let chatSeenScope = "";
let chatSeenIds = new Set<string>();
let chatUnread = 0;
function updateChatUnread() {
  const source = (roomClient ? room?.messages || [] : messages).filter(m=>m.channel === "table");
  const scope = roomClient ? room?.code || "room" : state.seed;
  if (scope !== chatSeenScope) { chatSeenScope = scope; chatSeenIds = new Set(source.map(m=>m.id)); chatUnread = 0; }
  for (const m of source) if (!chatSeenIds.has(m.id)) { chatUnread++; chatSeenIds.add(m.id); }
  if (document.body.classList.contains("side-expanded") && chatTab === "table") chatUnread = 0;
  if (chatSeenIds.size > 300) chatSeenIds = new Set(source.map(m=>m.id));
  $("#chat-unread").hidden = chatUnread === 0;
  $("#chat-launch").setAttribute("aria-label", chatUnread ? `開啟聊天，${chatUnread} 則新訊息` : "開啟聊天");
}
function renderTurn() {
  document.body.classList.toggle("observing-turn", current().isNpc || Boolean(roomClient && room?.selfId !== current().id));
  const p = current(),
    tile = state.tiles[p.position];
  if (state.phase === "finished") {
    $("#turn-card").innerHTML =
      `<div><span class="eyebrow">A CITY FULL OF MEMORIES</span><h3>這一局，精彩落幕！</h3><p>看看大家的城市建設與投資成果。</p></div><button class="primary" id="results">查看資產排名 ↗</button>`;
    $("#results").onclick = showResults;
    return;
  }
  if (state.phase === "action" || (state.phase === "roll" && (p.jailTurns > 0 || p.wantedSkip))) {
    renderDecision();
    return;
  }
  if (!canAct()) { $("#turn-card").innerHTML = ""; return; }
  const rolling = state.phase === "roll",
    moving = state.phase === "moving";
  $("#turn-card").innerHTML =
    `<div class="turn-info"><span class="eyebrow">${paused ? "遊戲已暫停" : p.isNpc ? "NPC 正在思考" : "輪到你了，城市建造者"}</span><h3>${avatar[state.currentPlayer]} ${esc(p.name)}${moving ? " · 前進中" : rolling ? "，出發吧！" : ` · ${esc(tile.name)}`}</h3><p>${moving ? `還有 ${state.pendingSteps} 格 · 每走一格，股票更新一次` : rolling ? (p.wantedSkip ? "被通緝：下次擲骰將跳過一次行動，可保釋或使用出獄卡。" : p.jailTurns > 0 ? `正在監獄，剩餘 ${p.jailTurns} 輪；可保釋或等待日曆推進。` : `${p.vehicleId ? VEHICLES.find((v) => v.id === p.vehicleId)?.name : "步行"} · ${getDiceCount(p)} 顆骰子`) : (typeNames[tile.type] || tile.type) + " · 查看右側可用操作"}</p></div><div class="turn-buttons"><button class="small-action" id="my-assets">${icon("home")} 我的資產</button><button class="roll-button" id="turn-action" ${!canAct() ? "disabled" : ""}><span class="dice-hand ${moving ? "moving" : ""}">${(state.dice.length ? state.dice : Array(getDiceCount(p)).fill(5)).map(diceMarkup).join("")}</span>${moving ? "移動中" : rolling ? (p.wantedSkip ? "跳過本次移動" : "擲骰子") : "結束回合"}<span class="button-arrow">→</span></button></div>`;
  $("#my-assets").onclick = () => showAssets(state.currentPlayer);
  $("#turn-action").onclick = () =>
    act({ type: rolling ? "roll" : "finishTurn" });
}
function actionButton(label: string, action: string, extra = "") {
  const p = current(), t = state.tiles[p.position];
  const cost = action === "buy" ? t.price : action === "upgrade" ? getUpgradeCost(state,t) : action === "bail" ? BAIL_COST : ["station","amusement"].includes(action) ? 100 : 0;
  const affordable = p.cash >= cost;
  return `<button class="action-option" data-action="${action}" ${canAct() && affordable ? "" : "disabled"} ${extra}>${label}${affordable ? "" : " · 現金不足"}<span>↗</span></button>`;
}
function setSideExpanded(expanded: boolean) {
  document.body.classList.toggle("side-expanded", expanded);
  try { localStorage.setItem("labu-chat-open", String(expanded)); } catch {}
  $("#chat-launch").setAttribute("aria-expanded", String(expanded));
  if (expanded) { chatTab = "table"; updateChatUnread(); }
  const control = $("#side-collapse");
  control.setAttribute("aria-expanded", String(expanded));
  control.setAttribute("aria-label", expanded ? "收合城市與聊天選單" : "展開城市與聊天選單");
  control.textContent = expanded ? "⌄" : "⌃";
}
function renderSide() {
  $("#side-collapse").onclick = () => setSideExpanded(!document.body.classList.contains("side-expanded"));
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((el) => {
    el.classList.toggle("active", el.dataset.panel === panelTab);
    el.onclick = () => {
      panelTab = el.dataset.panel!;
      setSideExpanded(true);
      renderSide();
    };
  });
  $("#chat-launch").onclick = () => { setSideExpanded(!document.body.classList.contains("side-expanded")); renderChat(); };
  $("#garage-launch").onclick = () => showVehicles(state.phase === "action" && state.tiles[current().position].type === "shop" && canAct(), roomClient ? Math.max(0, state.players.findIndex(p => p.id === room?.selfId)) : state.currentPlayer);
  renderChat();
}
let dismissedDecision = '';
function renderDecision() {
  const decisionKey=`${state.seed}:${state.turn}:${state.currentPlayer}:${state.phase}`;
  if (dismissedDecision === decisionKey) {
    $("#turn-card").innerHTML='<button id="reopen-decision" class="glass-button">📋 回合選項</button>';
    $("#reopen-decision").onclick=()=>{dismissedDecision='';renderTurn();};return;
  }
  const p = current(),
    t = state.tiles[p.position];
  let actions = "";
  if (state.phase === "action") {
    if (t.type === "property" && t.ownerId === null)
      actions += actionButton(`⌂ 購買地產 · ${money(t.price)}`, "buy");
    if (t.type === "property" && t.ownerId === p.id && t.level < 3 && !state.performedActions.includes("upgrade"))
      actions += actionButton(
        `↑ 建築升級 · ${money(getUpgradeCost(state, t))}`,
        "upgrade",
      );
    if (t.type === "bank")
      actions +=
        actionButton("▥ 存款 / 提款", "bank") +
        actionButton("↗ 股票交易", "market");
    if (t.type === "station" && !state.performedActions.includes("station"))
      actions += actionButton("⇢ 城市列車 · 10 萬元", "station");
    if (t.type === "shop")
      actions +=
        actionButton("▤ 道具商店", "shop") +
        actionButton("🚘 交通工具展示間", "vehicles");
    if (t.type === "amusement" && !state.performedActions.includes("amusement"))
      actions += actionButton("✦ 幸運轉盤 · 10 萬元", "amusement");
    if (t.type === "auction" && !state.performedActions.includes("auction"))
      actions += actionButton("⚑ 參與地產拍賣", "auction");
    if (t.type === "construction" && !state.performedActions.includes("upgrade"))
      actions += actionButton("⌂ 建設自己的地產", "construction");
  }
  if (state.phase === "roll" && p.jailTurns === 0)
    actions += actionButton(
      `🚘 我的車庫 · ${getDiceCount(p)} 顆骰子`,
      "garage",
    );
  if (state.phase === "roll" && (p.jailTurns > 0 || p.wantedSkip))
    actions += actionButton(`▥ 保釋 · ${money(BAIL_COST)}`, "bail");
  const readyGoals = CITY_GOALS.filter(g => !p.completedGoals.includes(g.id) && goalProgress(state,p,g.id).value >= goalProgress(state,p,g.id).target);
  if (readyGoals.length) actions += actionButton(`🎁 可領 ${readyGoals.length} 項目標獎勵`, "goals");
  if (p.cards.some(cardUsable)) actions += actionButton("🎴 使用手上的道具", "cards");
  const waiting = !canAct();
  const observing = p.isNpc || Boolean(roomClient && room?.selfId !== p.id);
  const recommendation = state.phase === "roll" ? `服刑中 · ${p.wantedSkip ? "下次行動跳過一次" : "剩餘 " + p.jailTurns + " 輪"}：可保釋、使用出獄卡，或等待。`
    : t.type === "property" && t.ownerId === p.id && t.level < 3 && !state.performedActions.includes("upgrade") ? "可以蓋房子提高租金，也可以保留現金結束回合。"
    : t.type === "bank" ? "可以存提款、交易股票；完成後結束回合。"
    : actions ? "選擇下方操作，或直接結束回合。" : "本格已結算，可以結束回合。";
  let arrivalIndex = -1;
  for (let i = state.log.length - 1; i >= 0; i--) {
    if (/抵達|擲出/.test(state.log[i].text)) { arrivalIndex = i; break; }
  }
  const outcome = state.log.slice(Math.max(0, arrivalIndex + 1)).filter(l => !/前進|行情/.test(l.text)).slice(-3);
  const buying = t.type === "property" && t.ownerId === null;
  const look = buying ? {title:"喜歡這塊地嗎？",cell:2}
    : outcome.length ? eventPresentation(outcome.at(-1)!.text)
    : t.type === "bank" ? {title:"歡迎來到銀行",cell:3}
    : t.type === "property" ? {title:"打造你的玩具街屋",cell:2}
    : t.type === "shop" ? {title:"逛逛玩具商店",cell:10}
    : {title:state.phase === "roll" ? "休息一下，準備出發" : "抵達新地點",cell:state.phase === "roll" ? 5 : 6};
  const receipt = outcome.map(l => `<p>${esc(l.text).replace(/([\d,.]+\s*萬元)/g,'<b>$1</b>')}</p>`).join("");
  $("#turn-card").innerHTML = `<section class="decision-panel${observing ? " observing-decision" : ""}" role="region" aria-label="抵達地點與下一步"><button id="dismiss-decision" class="arrival-close" aria-label="收合事件卡">×</button><div class="arrival-hero"><span class="event-art arrival-art" role="img" aria-label="${look.title}插圖" style="background-image:url('${eventAtlas}');background-position:${(look.cell % 4) * 100/3}% ${Math.floor(look.cell / 4)*50}%"></span><h2>${look.title}</h2></div><div class="decision-heading"><img src="${portraits[state.currentPlayer]}" alt=""><div><strong>${esc(p.name)} · ${esc(t.name)}</strong><p>${waiting ? "等待對方決定 · " : ""}${recommendation}</p></div></div>${receipt ? `<div class="arrival-receipt">${receipt}</div>` : ""}<div class="decision-options">${actions}</div><button class="primary" id="turn-action" ${waiting ? "disabled" : ""}>${state.phase === "roll" ? "等待／跳過移動" : buying ? "先不買 · 結束回合 →" : "確認繼續 · 結束回合 →"}</button></section>`;
  $("#dismiss-decision").onclick=()=>{dismissedDecision=decisionKey;renderTurn();};
  popupFeedback($(".decision-panel"), `${state.seed}:${state.turn}:${state.currentPlayer}:${state.phase}:${state.log.at(-1)?.id}`, look.title);
  $("#turn-action").onclick = () => act({type:state.phase === "roll" ? "roll" : "finishTurn"});
  document.querySelectorAll<HTMLElement>("[data-action]").forEach(
    (el) =>
      (el.onclick = () => {
        const action = el.dataset.action!;
        if (action === "goals") showGoals(state.currentPlayer);
        else if (action === "cards") showAssets(state.currentPlayer);
        else if (action === "bank") showBank();
        else if (action === "market") showMarket();
        else if (action === "shop") showShop();
        else if (action === "vehicles") showVehicles(true);
        else if (action === "garage") showVehicles(false);
        else if (action === "auction") showAuction();
        else if (action === "construction") showConstruction();
        else { closeModal(); act({ type: action } as GameAction); }
      }),
  );
}
function roomCommand(action: GameAction, after?: () => void) {
  const client = roomClient,
    revision = modalRevision;
  if (!client) return;
  void client
    .command(action)
    .then(() => {
      if (
        roomClient === client &&
        revision === modalRevision &&
        $<HTMLDialogElement>("#modal").open
      )
        after?.();
    })
    .catch((e) => {
      if (roomClient === client) toast(e.message);
    });
}
function act(action: GameAction, after?: () => void) {
  if (roomClient) {
    roomCommand(action, after);
    return;
  }
  try {
    const actorId = current().id;
    state = dispatch(state, action);
    maybeNpcComment(actorId, action);
    if (action.type === "step") audio.play("step");
    save();
    render();
    if (state.phase === "finished") {
      audio.play("win");
      showResults();
    }
    after?.();
    schedule();
  } catch (e) {
    toast(e instanceof Error ? e.message : "操作失敗，請再試一次。");
    schedule();
  }
}
function schedule() {
  clearTimeout(timer);
  if (roomClient || !started || paused || state.phase === "finished") return;
  if (state.phase === "moving")
    timer = setTimeout(() => act({ type: "step" }), state.pendingSteps === state.die ? DICE_MOVE_DELAY_MS : fast ? 110 : 420);
  else if (current().isNpc)
    timer = setTimeout(
      () => {
        try {
          const a = getNpcAction(state);
          if (a) act(a);
          else act({ type: "finishTurn" });
        } catch (e) {
          paused = true;
          toast("NPC 已暫停：" + String(e));
          render();
        }
      },
      fast ? 180 : 1100,
    );
}
function showAssets(index: number) {
  const p = state.players[index];
  showModal(
    modalHeader(
      "A LITTLE EMPIRE",
      `${avatar[index]} ${esc(p.name)}的資產`,
      `建築主題：${themeNames[p.theme]}`,
    ) +
      `<div class="stat-grid"><div><small>手上現金</small><strong>${money(p.cash)}</strong></div><div><small>銀行存款</small><strong>${money(p.deposit)}</strong></div><div><small>總資產估值</small><strong>${money(getNetWorth(state, p))}</strong></div></div><h3>城市地產</h3><div class="property-list">${
        state.tiles
          .filter((t) => t.ownerId === p.id)
          .map(
            (t) =>
              `<div><span>${esc(t.name)}</span><strong>${"▰".repeat(t.level || 1)} ${t.level} 級${ownsDistrict(state, t) ? " · 整區加成" : ""}</strong></div>`,
          )
          .join("") || '<p class="muted">還沒有地產，下一塊土地等著你。</p>'
      }</div><button class="secondary full" id="assets-goals">城市目標 · 查看獎勵 →</button><h3>我的車庫</h3><p class="muted">${p.vehicles.map((id) => esc(VEHICLES.find((v) => v.id === id)?.name)).join(" · ") || "尚無交通工具 · 目前步行"}</p><button class="secondary full" id="assets-garage">查看車庫 · 換乘 →</button><div class="prank-status">${p.wantedSkip ? "<span>🚓 通緝：待跳過一次行動</span>" : ""}${(p.wantedImmuneUntilRound ?? 0) > state.round ? `<span>🛡️ 通緝保護至第 ${p.wantedImmuneUntilRound} 輪</span>` : ""}</div><h3>我的道具 · ${p.cards.length}/${HAND_LIMIT}</h3><p class="fine-print">每回合限用 1 張攻擊卡；保鑣與免租券自動防守。</p><div class="chip-row">${p.cards.map((c, i) => `<button class="chip" data-card="${c}" ${index === state.currentPlayer && canAct() && cardUsable(c) ? "" : "disabled"}>${cardArt(c)}${cardNames[c]}${["rentShield", "bodyguard"].includes(c) ? "（自動）" : i === 0 ? " ✦" : ""}</button>`).join("") || '<span class="muted">到道具商店補充道具。</span>'}</div><h3>股票持倉</h3><p>累計股利：${money(p.dividendsReceived ?? 0)}（已入存款）</p><div class="holding-row"><span>累計已實現損益</span><strong>${p.realizedProfit >= 0 ? "+" : ""}${money(p.realizedProfit)}</strong></div>${
        state.stocks
          .filter((s) => p.holdings[s.id] > 0)
          .map(
            (s) =>
              `<div class="holding-row"><span>${esc(s.name)} · ${p.holdings[s.id]} 張</span><strong>${money(s.price * p.holdings[s.id])}</strong></div><div class="holding-row"><span>成本 ${money(p.costBasis[s.id])}</span><strong class="${s.price * p.holdings[s.id] - p.costBasis[s.id] >= 0 ? "up" : "down"}">未實現 ${s.price * p.holdings[s.id] - p.costBasis[s.id] >= 0 ? "+" : ""}${money(s.price * p.holdings[s.id] - p.costBasis[s.id])}</strong></div>`,
          )
          .join("") || '<p class="muted">到銀行買進第一支股票。</p>'
      }`,
  );
  $("#assets-goals").onclick = () => showGoals(index);
  $("#assets-garage").onclick = () => showVehicles(false, index);
  document.querySelectorAll<HTMLElement>("[data-card]").forEach(
    (el) =>
      (el.onclick = () => {
        const c = el.dataset.card! as Card;
        if (ATTACK_CARDS.includes(c)) { showPrankTargets(c); return; }
        if (c === "loadedDice") {
          showModal(
            modalHeader("MAKE YOUR MOVE", "指定骰") +
              `<p>指定第一顆骰子的點數；交通工具的其他骰子照常隨機。</p><div class="dice-choices">${[1, 2, 3, 4, 5, 6].map((n) => `<button data-die="${n}">${n}</button>`).join("")}</div>`,
          );
          document.querySelectorAll<HTMLElement>("[data-die]").forEach(
            (b) =>
              (b.onclick = () => {
                closeModal();
                act({
                  type: "useCard",
                  card: "loadedDice",
                  value: Number(b.dataset.die),
                });
              }),
          );
        } else if (c === "renovation") {
          showModal(
            modalHeader(
              "BUILD YOUR DREAM",
              "遠端建設卡",
              "抵達後可選自己的地產免費升一級；每回合共限建設一次。",
            ) +
              `<div class="shop-list">${
                state.tiles
                  .filter((t) => t.ownerId === p.id && t.level < 3 && !state.performedActions.includes("upgrade"))
                  .map(
                    (t) =>
                      `<button class="action-option" data-renovate="${t.id}">${esc(t.name)}<span>${t.level} → ${t.level + 1} 級</span></button>`,
                  )
                  .join("") || "<p>目前沒有可升級的地產。</p>"
              }</div>`,
          );
          document.querySelectorAll<HTMLElement>("[data-renovate]").forEach(
            (b) =>
              (b.onclick = () => {
                act(
                  {
                    type: "useCard",
                    card: "renovation",
                    tileId: Number(b.dataset.renovate),
                  },
                  closeModal,
                );
              }),
          );
        } else {
          closeModal();
          act({ type: "useCard", card: c } as GameAction);
        }
      }),
  );
}
function cardUsable(card: Card) {
  if (card === "rentShield" || card === "bodyguard") return false;
  if (ATTACK_CARDS.includes(card)) return (state.phase === "roll" || state.phase === "action") && current().jailTurns === 0 && !current().wantedSkip && !state.performedActions.includes("attack");
  if (card === "loadedDice") return state.phase === "roll" && current().jailTurns === 0 && !current().wantedSkip && state.nextDice === null;
  if (card === "jailFree") return (state.phase === "roll" || state.phase === "action") && (current().jailTurns > 0 || !!current().wantedSkip);
  return state.phase === "action" && current().jailTurns === 0 && !state.performedActions.includes("upgrade");
}
function showPrankTargets(card: Card) {
  const p = current();
  const tileCard = ["roadblock", "trap", "shutdown"].includes(card);
  let choices = "";
  if (tileCard) {
    const eligible = state.tiles.filter(t => card === "shutdown"
      ? t.type === "property" && t.ownerId !== null && t.ownerId !== p.id && (t.closedUntilTurn ?? 0) <= state.turn
      : card === "trap" ? t.type === "property" && t.ownerId === null && t.id !== p.position && !state.hazards?.some(h => h.tileId === t.id)
      : ((t.id - p.position + 48) % 48) >= 1 && ((t.id - p.position + 48) % 48) <= 12 && !state.hazards?.some(h => h.tileId === t.id));
    choices = eligible.map(t => `<button class="action-option prank-target" data-prank-tile="${t.id}"><span><b>第 ${t.id + 1} 格 · ${esc(t.name)}</b><small>${card === "shutdown" ? esc(state.players.find(x => x.id === t.ownerId)?.name) + " · " + t.level + " 級" : card === "roadblock" ? "前方 " + ((t.id - p.position + 48) % 48) + " 格" : "無主地產"}</small></span><span>選擇 →</span></button>`).join("");
  } else {
    choices = state.players.filter(t => t.id !== p.id && !t.bankrupt).map(t => {
      const blocked = ((card === "wanted" || card === "swap") && (t.jailTurns > 0 || t.wantedSkip)) || (card === "wanted" && (t.wantedImmuneUntilRound ?? 0) > state.round) || (card === "steal" && t.cash <= 0);
      return `<button class="action-option prank-target" data-prank-player="${esc(t.id)}" ${blocked ? "disabled" : ""}><span><b>${esc(t.name)}</b><small>現金 ${money(t.cash)}${t.cards.includes("bodyguard") ? " · 🛡️ 保鑣會抵擋通緝／偷錢" : ""}${t.jailTurns > 0 || t.wantedSkip ? " · 正在服刑" : ""}${(t.wantedImmuneUntilRound ?? 0) > state.round ? " · 通緝保護至第 " + t.wantedImmuneUntilRound + " 輪" : ""}</small></span><span>${card === "steal" ? "預計 " + money(Math.min(300, Math.floor(t.cash * .1))) : "選擇 →"}</span></button>`;
    }).join("");
  }
  showModal(modalHeader("A LITTLE MISCHIEF", cardNames[card], CARD_DESCRIPTIONS[card]) + `<p class="fine-print">${state.performedActions.includes("attack") ? "本回合已使用攻擊卡。" : "選好目標後確認使用；取消不會消耗卡片。"}</p><div class="shop-list">${choices || "<p>目前沒有適用的目標。</p>"}</div>`);
  document.querySelectorAll<HTMLElement>("[data-prank-player], [data-prank-tile]").forEach(el => el.onclick = () => {
    const targetId = el.dataset.prankPlayer;
    const tileId = el.dataset.prankTile === undefined ? undefined : Number(el.dataset.prankTile);
    const name = targetId ? state.players.find(t => t.id === targetId)?.name : state.tiles[tileId!]?.name;
    showModal(modalHeader("READY FOR MISCHIEF?", cardNames[card], CARD_DESCRIPTIONS[card]) + `<div class="preview-box">目標：<strong>${esc(name)}</strong></div><p>使用後消耗 1 張卡片及本回合攻擊機會。保鑣若抵擋，攻擊卡仍會消耗。</p><button class="primary full" id="confirm-prank">確認使用 →</button><button class="secondary full" id="cancel-prank">重新選擇</button>`);
    $("#confirm-prank").onclick = () => act({ type: "useCard", card, ...(targetId ? { targetId } : { tileId }) }, closeModal);
    $("#cancel-prank").onclick = () => showPrankTargets(card);
  });
}
function showGoals(index = state.currentPlayer) {
  const p = state.players[index];
  showModal(
    modalHeader(
      "CITY DREAMS",
      "城市目標",
      "每位玩家每個目標限領一次，達成後可在擲骰前或抵達後領取。",
    ) +
      `<div class="goal-list">${CITY_GOALS.map((g) => {
        const progress = goalProgress(state, p, g.id);
        const claimed = p.completedGoals.includes(g.id);
        return `<article class="goal-card"><h3>${g.name}</h3><p>${g.detail}</p><progress max="${progress.target}" value="${progress.value}"></progress><div class="holding-row"><span>${progress.value} / ${progress.target}</span><strong>${money(g.reward)}</strong></div><button class="secondary full" data-goal="${g.id}" ${!claimed && progress.value >= progress.target && index === state.currentPlayer && canAct() && (state.phase === "roll" || state.phase === "action") ? "" : "disabled"}>${claimed ? "已領取" : "領取獎勵"}</button></article>`;
      }).join(
        "",
      )}</div><h3>街區經營</h3><p>擁有整個街區：租金 +50%，付費建設享八折。失去任一地產即失去加成。</p><div class="property-list">${DISTRICT_NAMES.map(
        (name, district) => {
          const group = state.tiles.filter(
            (t) => t.type === "property" && t.district === district,
          );
          return `<div><span>${name}</span><strong>${group.filter((t) => t.ownerId === p.id).length} / ${group.length}</strong></div>`;
        },
      ).join("")}</div>`,
  );
  document
    .querySelectorAll<HTMLElement>("[data-goal]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          act({ type: "claimGoal", goalId: b.dataset.goal! }, () =>
            showGoals(index),
          )),
    );
}
function financePlayer() { return roomClient ? state.players.find(p=>p.id===room?.selfId) || current() : current().isNpc ? state.players.find(p=>!p.isNpc && !p.bankrupt) || current() : current(); }
function financeAvailable() { const p=financePlayer(); return started && !paused && state.phase !== 'finished' && !p.bankrupt && !p.isNpc && (!roomClient || networkConnected && !room?.pendingReclaim); }
function bankAvailable() { const p=financePlayer(); return financeAvailable() && ((state.tiles[p.position].type === 'bank' && !(p.id===current().id && state.phase==='moving')) || (p.mobileBankUses ?? 0)<3); }
function showBank(mode: "deposit" | "withdraw" = "deposit") {
  const p = financePlayer();
  showModal(
    `<div class="bank-welcome"><img src="${bankArt}" alt=""><div>${modalHeader("TOY CITY BANK", "玩具銀行", "存下一點夢想，準備下一次冒險。")}</div></div>` +
      `<div class="modal-tabs"><button class="active">存提款</button><button id="bank-stocks">股票交易 ↗</button></div><div class="balance-cards"><div><span>手上現金</span><strong>${money(p.cash)}</strong></div><div><span>銀行存款</span><strong>${money(p.deposit)}</strong></div></div><div class="segmented"><button id="mode-deposit" class="${mode === "deposit" ? "active" : ""}">存入銀行</button><button id="mode-withdraw" class="${mode === "withdraw" ? "active" : ""}">領出現金</button></div><form id="bank-form"><label class="form-label" for="bank-amount">${mode === "deposit" ? "存入" : "領出"}金額</label><div class="amount-input"><input id="bank-amount" type="number" min="0.1" step="0.1" value="100" required><span>萬元</span></div><div class="chip-row">${[50, 100, 200].map((v) => `<button type="button" class="chip" data-amount="${v}">${v} 萬元</button>`).join("")}<button class="chip" type="button" data-amount="${(mode === "deposit" ? p.cash : p.deposit) / 10}">全部</button></div><div id="bank-preview" class="preview-box"></div><button class="primary full" ${bankAvailable() ? "" : "disabled"}>確認${mode === "deposit" ? "存入" : "領出"} →</button></form><p class="fine-print">必要費用不足時會自動動用存款。提款卡剩餘 ${3-(p.mobileBankUses ?? 0)}／3 次；停到銀行自動補滿，銀行辦理不扣次數。股票不限地點。</p>`,
  );
  $("#bank-stocks").onclick = () => showMarket();
  $("#mode-deposit").onclick = () => showBank("deposit");
  $("#mode-withdraw").onclick = () => showBank("withdraw");
  const preview = () => {
    const amount = Math.round(
      Number($<HTMLInputElement>("#bank-amount").value) * 10,
    );
    $("#bank-preview").innerHTML =
      `<span>交易後現金 <strong>${money(p.cash + (mode === "deposit" ? -amount : amount))}</strong></span><span>交易後存款 <strong>${money(p.deposit + (mode === "deposit" ? amount : -amount))}</strong></span>`;
  };
  document.querySelectorAll<HTMLElement>("[data-amount]").forEach(
    (b) =>
      (b.onclick = () => {
        $<HTMLInputElement>("#bank-amount").value = b.dataset.amount!;
        preview();
      }),
  );
  $("#bank-amount").oninput = preview;
  preview();
  $("#bank-form").onsubmit = (e) => {
    e.preventDefault();
    if (roomClient) {
      roomCommand(
        {
          type: mode,
        actorId: p.id,
          amount: Math.round(
            Number($<HTMLInputElement>("#bank-amount").value) * 10,
          ),
        },
        () => {
          showBank(mode);
          toast("交易完成");
        },
      );
      return;
    }
    try {
      state = dispatch(state, {
        type: mode,
        actorId: p.id,
        amount: Math.round(
          Number($<HTMLInputElement>("#bank-amount").value) * 10,
        ),
      });
      save();
      render();
      showBank(mode);
      toast("交易完成");
    } catch (err) {
      toast(String(err instanceof Error ? err.message : err));
    }
  };
}
function showMarket(
  stockId?: string,
  mode: "buyStock" | "sellStock" = "buyStock",
) {
  const stock = state.stocks.find((s) => s.id === stockId) || state.stocks[0],
    p = financePlayer();
  const min = Math.min(...stock.history),
    max = Math.max(...stock.history);
  const pts = stock.history
    .map(
      (v, i) =>
        `${(i / Math.max(1, stock.history.length - 1)) * 500},${130 - ((v - min) / Math.max(1, max - min)) * 105}`,
    )
    .join(" ");
  showModal(
    modalHeader(
      "THE LITTLE STOCK EXCHANGE",
      "玩具交易所",
      `${financeAvailable() ? "隨時交易 · 使用自己的存款" : "行情查看模式 · 目前不可交易"} · 第 ${state.marketTick} 步行情`,
    ) +
      `<div class="exchange-layout"><div class="stock-list">${state.stocks.map((s) => `<button class="${s.id === stock.id ? "selected" : ""}" data-select-stock="${s.id}"><span>${esc(s.name)}</span><strong>${stockQuote(s.price)}</strong></button>`).join("")}</div><div class="stock-detail"><div class="stock-heading"><h3>${esc(stock.name)}</h3><strong>${stockQuote(stock.price)}</strong></div><svg class="chart" viewBox="0 0 500 160" role="img" aria-label="股價走勢"><path d="M0 30H500M0 80H500M0 130H500" stroke="#e9e6df" fill="none"/><polyline points="${pts}" fill="none" stroke="#ef7055" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><p class="fine-print">${SEASONS[DIVIDENDS[state.stocks.indexOf(stock)].season]}季末預定每股配息 ${DIVIDENDS[state.stocks.indexOf(stock)].perShare} 元；季末持有者領取，同時除息，低價時可能停配。</p><div class="chart-caption"><span>最近 ${stock.history.length} 次價格</span><span>每步行情／季末除息</span></div><div class="segmented"><button id="stock-buy" class="${mode === "buyStock" ? "active" : ""}">買進</button><button id="stock-sell" class="${mode === "sellStock" ? "active" : ""}">賣出</button></div><form id="stock-form"><div class="holding-row"><span>銀行存款</span><strong>${money(p.deposit)}</strong></div><div class="holding-row"><span>目前持有</span><strong>${p.holdings[stock.id] || 0} 張</strong></div><div class="holding-row"><span>持股成本</span><strong>${money(p.costBasis[stock.id] || 0)}</strong></div><div class="holding-row"><span>未實現損益</span><strong class="${stock.price * p.holdings[stock.id] - (p.costBasis[stock.id] || 0) >= 0 ? "up" : "down"}">${money(stock.price * p.holdings[stock.id] - (p.costBasis[stock.id] || 0))}</strong></div><label for="stock-qty" class="form-label">交易張數（1 張＝1,000 股）</label><div class="amount-input"><input id="stock-qty" type="number" min="1" max="100000" step="1" value="1" required><span>張</span></div><div class="preview-box" id="stock-preview"></div><button class="primary full" ${financeAvailable() ? "" : "disabled"}>確認${mode === "buyStock" ? "買進" : "賣出"} →</button></form></div></div><p class="fine-print">每股報價、整張交易；1 張＝1,000 股。買進扣存款、賣出回存款。每步更新行情；季末另依配息表除息並發股利。</p>`,
    true,
  );
  document
    .querySelectorAll<HTMLElement>("[data-select-stock]")
    .forEach(
      (el) => (el.onclick = () => showMarket(el.dataset.selectStock, mode)),
    );
  $("#stock-buy").onclick = () => showMarket(stock.id, "buyStock");
  $("#stock-sell").onclick = () => showMarket(stock.id, "sellStock");
  const preview = () => {
    const total = Number($<HTMLInputElement>("#stock-qty").value) * stock.price;
    $("#stock-preview").innerHTML =
      `<span>成交金額 <strong>${money(total)}</strong></span><span>交易後存款 <strong>${money(p.deposit + (mode === "buyStock" ? -total : total))}</strong></span>`;
  };
  $("#stock-qty").oninput = preview;
  preview();
  $("#stock-form").onsubmit = (e) => {
    e.preventDefault();
    if (roomClient) {
      roomCommand(
        {
          type: mode,
        actorId: p.id,
          stockId: stock.id,
        expectedPrice: stock.price,
          quantity: Number($<HTMLInputElement>("#stock-qty").value),
        },
        () => {
          showMarket(stock.id, mode);
          toast("股票交易完成");
        },
      );
      return;
    }
    try {
      state = dispatch(state, {
        type: mode,
        actorId: p.id,
        stockId: stock.id,
        expectedPrice: stock.price,
        quantity: Number($<HTMLInputElement>("#stock-qty").value),
      });
      save();
      render();
      showMarket(stock.id, mode);
      toast("股票交易完成");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };
}
function tileEffectBadge(tileId: number) {
  const hazard = state.hazards?.find(h => h.tileId === tileId && h.expiresTurn > state.turn);
  const closed = (state.tiles[tileId].closedUntilTurn ?? 0) > state.turn;
  return hazard ? `<span class="hazard-badge">${hazard.kind === "roadblock" ? "🚧 路障：經過停下" : "🪤 陷阱：現金清理費最多 15 萬元"} · 剩 ${hazard.expiresTurn - state.turn} 個玩家回合</span>` : closed ? `<span class="hazard-badge">🛑 暫停收租 · 剩 ${(state.tiles[tileId].closedUntilTurn ?? 0) - state.turn} 個玩家回合</span>` : "";
}
function showTile(index: number) {
  const t = state.tiles[index],
    owner = state.players.find((p) => p.id === t.ownerId);
  showModal(
    modalHeader(
      `TILE ${String(index + 1).padStart(2, "0")}`,
      esc(t.name),
      typeNames[t.type] || t.type,
    ) +
      `<div class="tile-illustration ${t.type}">${t.type === "bank" ? `<img src="${bankArt}" alt="玩具銀行">` : t.type === "property" ? `<img src="${townhouseArt}" alt="城市街屋">` : t.type === "prison" ? "🔒" : "🎡"}</div>${tileEffectBadge(index)}<div class="holding-row"><span>擁有者</span><strong>${owner ? esc(owner.name) : "公共設施 / 尚無擁有者"}</strong></div>${t.type === "property" ? `<div class="holding-row"><span>土地售價</span><strong>${money(t.price)}</strong></div><div class="holding-row"><span>升級費用</span><strong>${money(getUpgradeCost(state, t))}</strong></div><div class="holding-row"><span>目前租金</span><strong>${money(getRent(t, state))}</strong></div><div class="holding-row"><span>${DISTRICT_NAMES[t.district]}</span><strong>${ownsDistrict(state, t) ? "整區 · 租金 +50%／建設八折" : "集齊整區可獲加成"}</strong></div><div class="holding-row"><span>建築等級</span><strong>${t.level} / 3</strong></div>` : ""}<p class="muted">${t.type === "bank" ? "在銀行存提款不限次數；股票可隨時交易。" : t.type === "prison" ? "普通路過只是探訪；被送入監獄才會受罰。" : "擲骰移動到這個地塊，觸發對應事件。"}</p><button class="secondary full" id="locate-tile">在地圖定位 →</button>`,
  );
  $("#locate-tile").onclick = () => {
    closeModal();
    city?.focus(index);
  };
}
function showShop() {
  showModal(
    modalHeader(
      "A LITTLE HELP",
      "道具商店",
      `道具放進「我的資產」。手牌 ${current().cards.length}/${HAND_LIMIT} 張，每次到店限購一張。`,
    ) +
      `<div class="shop-list">${Object.entries(cardNames)
        .map(
          ([id, name]) =>
            `<button class="action-option card-shop-item" data-shop-card="${id}" ${!canAct() || current().cards.length >= HAND_LIMIT || current().cash < CARD_PRICES[id as Card] || state.performedActions.includes("shop") ? "disabled" : ""}>${cardArt(id)}<span><b>${name}</b><small>${cardSummaries[id]}</small></span><strong>${money(CARD_PRICES[id as Card])} →</strong></button><details class="card-rules"><summary>${name} · 詳細規則</summary><p>${esc(CARD_DESCRIPTIONS[id as Card])}</p></details>`,
        )
        .join("")}</div>`,
  );
  document.querySelectorAll<HTMLElement>("[data-shop-card]").forEach(
    (el) =>
      (el.onclick = () => {
        act({ type: "shop", card: el.dataset.shopCard } as GameAction, closeModal);
      }),
  );
}
function showAuction() {
  const tile = state.tiles[state.auctionTileId ?? -1];
  if (!tile) {
    toast("目前沒有可拍賣的地產。");
    return;
  }
  showModal(
    modalHeader(
      "MAKE IT YOURS",
      "地產拍賣",
      `${esc(tile.name)} · 起標 ${money(Math.floor(tile.price * 0.65))} · 本格訪客與 NPC 競標`,
    ) +
      `<form id="auction-form"><label class="form-label" for="bid">你的出價（萬元）</label><div class="amount-input"><input id="bid" type="number" min="${Math.floor(tile.price * 0.65) / 10}" step="0.1" value="${Math.floor(tile.price * 0.65) / 10}" required><span>萬元</span></div><button class="primary full">確認出價 →</button></form>`,
  );
  $("#auction-form").onsubmit = (e) => {
    e.preventDefault();
    act({
      type: "auction",
      bid: Math.round(Number($<HTMLInputElement>("#bid").value) * 10),
    });
    closeModal();
  };
}
function showConstruction() {
  showModal(
    modalHeader("BUILD SOMETHING GREAT", "建設中心") +
      state.tiles
        .filter((t) => t.ownerId === current().id && t.level < 3)
        .map(
          (t) =>
            `<button class="action-option" data-upgrade="${t.id}">${esc(t.name)} · ${money(getUpgradeCost(state, t))} <span>升級 ↗</span></button>`,
        )
        .join(""),
  );
  document.querySelectorAll<HTMLElement>("[data-upgrade]").forEach(
    (el) =>
      (el.onclick = () => {
        act(
          { type: "upgrade", tileId: Number(el.dataset.upgrade) },
          showConstruction,
        );
      }),
  );
}

function showVehicles(store = false, index = state.currentPlayer) {
  const p = state.players[index];
  const equipped = VEHICLES.find((v) => v.id === p.vehicleId);
  const editable = index === state.currentPlayer && canAct();
  showModal(
    modalHeader(
      "THE LITTLE MOTOR CLUB",
      store ? "交通工具展示間" : "我的玩具車庫",
      `步行 1 顆 · 腳踏車／機車 2 顆 · 汽車 3 顆骰子`,
    ) +
      `<div class="garage-current"><span>目前交通工具</span><strong>${equipped ? esc(equipped.name) : "步行"} · ${getDiceCount(p)} 顆骰子</strong></div><div class="vehicle-grid">${VEHICLES.map(
        (v) => {
          const owned = p.vehicles.includes(v.id);
          return `<article class="vehicle-card"><div class="vehicle-model-preview"><img src="${vehiclePreviews[v.id]}" alt="${esc(v.name)} 立體模型" loading="eager"></div><span class="vehicle-dice">${Array(v.diceCount).fill(5).map(diceMarkup).join("")} <span>${v.diceCount} 顆骰子</span></span><h3>${esc(v.name)}</h3><p>${money(v.price)}</p>${store ? `<button class="${owned ? "secondary" : "primary"} full" data-buy-vehicle="${v.id}" ${!editable || owned || state.performedActions.includes("buyVehicle") ? "disabled" : ""}>${owned ? "已收藏" : "購入車庫 →"}</button>` : `<button class="secondary full" data-equip-vehicle="${v.id}" ${!editable || !owned || p.vehicleId === v.id || state.phase !== "roll" || p.jailTurns > 0 ? "disabled" : ""}>${p.vehicleId === v.id ? "正在使用" : owned ? "換乘 →" : "尚未擁有"}</button>`}</article>`;
        },
      ).join(
        "",
      )}</div>${!store ? `<button id="walk" class="secondary full" ${!editable || p.vehicleId === null || state.phase !== "roll" || p.jailTurns > 0 ? "disabled" : ""}>改為步行 · 1 顆骰子</button>` : ""}<p class="fine-print">每次到商店限購一款；購入後在自己的下一次擲骰前換乘。同骰數款式的差異為造型與價格。Tesla 車款為非官方遊戲玩具造型，金額為虛構遊戲價格。</p>`,
    true,
  );
  document.querySelectorAll<HTMLElement>("[data-buy-vehicle]").forEach(
    (el) =>
      (el.onclick = () => {
        act({ type: "buyVehicle", vehicleId: el.dataset.buyVehicle! }, () =>
          showVehicles(true, index),
        );
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-equip-vehicle]").forEach(
    (el) =>
      (el.onclick = () => {
        act({ type: "equipVehicle", vehicleId: el.dataset.equipVehicle! }, () =>
          showVehicles(false, index),
        );
      }),
  );
  if (!store)
    $("#walk").onclick = () => {
      act({ type: "equipVehicle", vehicleId: null }, () =>
        showVehicles(false, index),
      );
    };
}

let lastNpcTurn = -1;
function requestNpc(text = "", speakerId?: string) {
  const seed = state.seed;
  const context = npcContext(state, speakerId ?? state.players.find((p) => p.isNpc && p.name === "Labu")?.id, messages);
  labuPending += 1;
  const task = labuQueue.then(() => {
    if (state.seed !== seed || roomClient || !started) return;
    messages.push({ id: crypto.randomUUID(), author: context.speaker, channel: "table", text: npcFallback(context, text), source: "offline", at: Date.now() });
    messages = messages.slice(-120);
  }).finally(() => {
    labuPending -= 1;
    if (panelTab === "chat" && chatTab === "table") renderChat();
  });
  labuQueue = task.catch(() => {});
  return task;
}
function maybeNpcComment(_actorId: string, action: GameAction) {
  const attack = action.type === "useCard" && ATTACK_CARDS.includes(action.card);
  if (!roomClient && (attack || state.phase === "action" && lastNpcTurn !== state.turn)) {
    lastNpcTurn = state.turn;
    void requestNpc();
  }
}
function renderChat() {
  updateChatUnread();
  const previousInput = $<HTMLInputElement>("#chat-input");
  if (previousInput)
    chatDrafts[previousInput.dataset.channel || "table"] = previousInput.value;
  const draft = chatDrafts[chatTab] || "";
  const wasFocused = document.activeElement?.id === "chat-input";
  const personal = chatTab === "private";
  const remaining = roomClient ? room?.labu?.remaining ?? 10 : Math.max(0, 10 - (labuUsage.get(labuUsageKey()) || 0));
  const pending = roomClient ? room?.labu?.pending ?? 0 : labuPending;
  $("#side-content").innerHTML =
    `<div class="chat-layout"><div class="chat-subtabs"><button id="chat-public" class="${!personal ? "active" : ""}">同桌</button><button id="chat-private" class="${personal ? "active" : ""}">我的 Labu <span>2</span></button></div><details class="chat-privacy"><summary>聊天說明</summary><div class="offline-note">Labu 使用預設台詞，依遊戲狀況給提示；私人提醒不會出現在同桌聊天。</div></details><div class="chat-messages" id="chat-messages">${
      personal
        ? `<div class="private-label">🔒 私人提醒示範 · 不會貼到公共聊天</div>${getDemoReminders()
            .filter((r) => !reminderDismissed.has(r.id))
            .map(
              (r) =>
                `<article class="reminder"><small>${r.source} · ${r.status === "done" ? "已完成" : r.status === "working" ? "處理中" : "需要確認"}</small><strong>${esc(r.title)}</strong><p>${esc(r.body)}</p><button data-dismiss="${r.id}">知道了</button></article>`,
            )
            .join("")}`
        : ""
    }${(roomClient && !personal ? room?.messages || [] : messages)
      .filter((m) => m.channel === (personal ? "private" : "table"))
      .slice(-50)
      .map(
        (m) =>
          `<div class="chat-message ${m.author === "Labu" ? "from-labu" : "from-player"}"><small>${esc(m.author)}${m.source === "offline" ? " · 預設台詞" : ""}</small><p>${esc(m.text)}</p></div>`,
      )
      .join(
        "",
      )}</div>${!personal ? `<div class="offline-note" role="status">本輪可問 Labu ${remaining}／10 次${pending ? ` · Labu 回覆中（${pending}）` : ""} · 不需冷卻</div>` : ""}<div class="chat-quick">${!personal ? `<button type="button" id="labu-mode" aria-pressed="${askLabuMode}">${askLabuMode ? "✓ 正在和 Labu 聊天" : "和 Labu 聊天"}</button>` : ""}<button data-quick="怎麼買股票？">怎麼買股票？</button><button data-quick="提醒我待辦">我的待辦</button></div><form id="chat-form"><label class="sr-only" for="chat-input">聊天訊息</label><input id="chat-input" data-channel="${chatTab}" maxlength="280" placeholder="${personal ? "私人提醒，僅自己可見" : askLabuMode ? "問 Labu 規則、策略，或聊聊這一局…" : "同桌聊天；提到 Labu、拉布、老布會回覆"}" autocomplete="off"><button aria-label="送出聊天訊息">↑</button></form></div>`;
  const labuMode = document.querySelector<HTMLButtonElement>("#labu-mode");
  if (labuMode) labuMode.onclick = () => { askLabuMode = !askLabuMode; renderChat(); $("#chat-input").focus(); };
  $("#chat-public").onclick = () => {
    chatTab = "table";
    renderChat();
  };
  $("#chat-private").onclick = () => {
    chatTab = "private";
    renderChat();
  };
  document.querySelectorAll<HTMLElement>("[data-dismiss]").forEach(
    (el) =>
      (el.onclick = () => {
        reminderDismissed.add(el.dataset.dismiss!);
        renderChat();
      }),
  );
  const send = (text: string, explicitAsk = askLabuMode) => {
    text = sanitizeChatText(text);
    if (!text) return;
    const ask = !personal && shouldAskLabu(text, explicitAsk);
    if (ask && remaining <= 0) { toast("本輪已詢問 Labu 10 次，下一輪會恢復；仍可取消聊天模式與大家聊天。"); return; }
    if (roomClient && !personal) {
      $<HTMLInputElement>("#chat-input").value = "";
      chatDrafts.table = "";
      void roomClient.chat(text, ask).catch((e) => toast(e.message));
      return;
    }
    const channel = personal ? "private" : "table";
    const author = roomClient
      ? room?.players.find((p) => p.id === room?.selfId)?.name || "你"
      : current().isNpc
        ? "你"
        : current().name;
    messages.push({
      id: crypto.randomUUID(),
      channel,
      author,
      text,
      at: Date.now(),
    });
    if (ask) {
      labuUsage.set(labuUsageKey(), (labuUsage.get(labuUsageKey()) || 0) + 1);
      void requestNpc(text);
    } else if (personal)
      messages.push({
        id: crypto.randomUUID(),
        channel,
        author: "Labu",
        text: replyAsLabu(text, {
          playerName: author,
          round: state.round,
          bankCount: 6,
        }),
        at: Date.now(),
      });
    messages = messages.slice(-120);
    $<HTMLInputElement>("#chat-input").value = "";
    renderChat();
    $<HTMLInputElement>("#chat-input").focus();
  };
  $("#chat-form").onsubmit = (e) => {
    e.preventDefault();
    send($<HTMLInputElement>("#chat-input").value);
  };
  document.querySelectorAll<HTMLElement>("[data-quick]").forEach(
    (el) =>
      (el.onclick = () => {
        if (el.dataset.quick === "提醒我待辦") {
          chatTab = "private";
          renderChat();
        } else send(el.dataset.quick!, true);
      }),
  );
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
  $<HTMLInputElement>("#chat-input").value = draft;
  if (wasFocused) $<HTMLInputElement>("#chat-input").focus();
}
function showResults() {
  const ranking = getRankings(state);
  showModal(
    modalHeader(
      "EVERY LITTLE DREAM COUNTS",
      "這座城市，因你而精彩",
      "本局資產排名 · 現金＋存款＋股票市值＋地產估值＋載具殘值",
    ) +
      `<div class="results-trophy">🏆</div>${ranking.map((p, i) => `<div class="ranking-row"><b>${String(i + 1).padStart(2, "0")}</b><span>${avatar[state.players.indexOf(p)]} ${esc(p.name)}<small>${themeNames[p.theme]}</small></span><strong>${money(getNetWorth(state, p))}</strong></div>`).join("")}<button id="play-again" class="primary full">再建一座夢想城市 →</button>`,
  );
  $("#play-again").onclick = () => {
    closeModal();
    showLobby();
  };
}
function showHelp() {
  showModal(
    modalHeader("HOW TO PLAY", "一場小小的城市冒險") +
      `<ol class="rules"><li><b>擲骰前進</b><p>步行 1 顆骰子，腳踏車／機車 2 顆，汽車 3 顆。點數加總移動，每走一格，六支虛構股票同時更新一次。傳送不更新。</p></li><li><b>買地與建設</b><p>停在無主地產可以購買；自己的地產可升級至三級。各玩家建築外觀不同，收益規則相同。集齊同一街區租金 +50%、付費建設八折；失去任一地產，加成消失。</p></li><li><b>銀行與投資</b><p>股票隨時可買賣；提款卡有 3 次遠端存提款，停到銀行自動補滿；銀行辦理不限次數。每兩輪各街區房價有漲跌，影響售價、估值與租金。必要費用先用現金，再用存款，仍不足將自動清算資產。</p></li><li><b>探索城市設施</b><p>車站、商店、機會廣場、遊樂園、稅務局、監獄和建設中心都有不同效果。監獄可保釋或等待。</p></li><li><b>城市目標與建設卡</b><p>「我的資產 → 城市目標」可查看三種一次性獎勵。道具店的遠端建設卡可在抵達後免費升級任一自己的地產，每回合共限建設一次。</p></li><li><b>惡作劇與防守</b><p>到道具商店買通緝令、小偷、路障、陷阱、停業或換位卡，再從「我的資產」選目標。每回合最多 1 張攻擊卡，手牌上限 5 張；保鑣自動擋一次通緝或偷錢。小偷只偷現金的 10%，最多 30 萬元。通緝最多錯過一次行動，並有保護避免連關。路障與陷阱會在城市全圖標示。</p></li><li><b>獲勝</b><p>達到設定輪數或只剩一位未破產玩家時結算。總資產最高者獲勝。</p></li></ol><p class="fine-print">支援離線同桌或開房邀朋友連線，空位由 NPC 補齊。Labu 私人提醒只顯示於自己的頁面。</p>`,
  );
}
function showSettings() {
  showModal(
    modalHeader("MAKE YOURSELF AT HOME", "遊戲設定") +
      `<div class="setting-row"><div><strong>可愛音效</strong><small>輕柔收款、付款、骰子與升級提示</small></div><button id="toggle-sound" class="chip" aria-pressed="${audio.enabled}">${audio.enabled ? "已開啟" : "已關閉"}</button></div><div class="setting-row"><div><strong>城市配樂</strong><small>輕快的玩具城市原創循環曲</small></div><button id="toggle-music" class="chip">${music.enabled ? "已開啟" : "已關閉"}</button></div><div class="setting-row"><div><strong>快速動畫</strong><small>縮短移動與 NPC 等待時間</small></div><button id="toggle-speed" class="chip">${fast ? "已開啟" : "已關閉"}</button></div><div class="setting-row"><div><strong>暫停遊戲</strong><small>暫停 NPC 與逐格移動</small></div><button id="toggle-pause" class="chip">${paused ? "繼續遊戲" : "暫停"}</button></div><div class="setting-row"><div><strong>輕量畫質</strong><small>降低像素密度與陰影負擔</small></div><button id="low-quality" class="chip">套用</button></div><div class="setting-row"><div><strong>存檔</strong><small>${roomClient ? "房間由本機伺服器管理，重啟不保留" : saveFailed ? "自動儲存不可用" : "每次操作自動保存在此瀏覽器"}</small></div><button id="export-save" class="chip">匯出</button></div><label class="import-label">匯入本機存檔<input id="import-save" type="file" accept="application/json,.json"></label><button id="new-game" class="secondary full">重新開局</button><p class="fine-print">${roomClient ? "目前使用本機連線房間。公開聊天由同桌玩家共享；私人 Labu 提醒只顯示在自己的頁面。" : "目前使用本機同桌模式，聊天只存在本次頁面。"} Labu 提醒仍為示範資料。</p>`,
  );
  $("#toggle-sound").onclick = () => { toggleSound(); $("#toggle-sound").textContent = audio.enabled ? "已開啟" : "已關閉"; $("#toggle-sound").setAttribute("aria-pressed", String(audio.enabled)); };
  $("#toggle-music").onclick = () => {
    void music.toggle().then((enabled) => {
      if ($("#toggle-music"))
        $("#toggle-music").textContent = enabled ? "已開啟" : "已關閉";
    });
  };
  $("#toggle-speed").onclick = () => {
    if (roomClient) {
      toast("連線模式的移動速度由房間伺服器決定。");
      return;
    }
    fast = !fast;
    schedule();
    showSettings();
  };
  $("#toggle-pause").onclick = () => {
    if (roomClient) {
      toast("連線房間不支援單人暫停，其他玩家仍可繼續。");
      return;
    }
    paused = !paused;
    schedule();
    render();
    showSettings();
  };
  $("#low-quality").onclick = () => {
    city?.setQuality(true);
    toast("已啟用輕量畫質");
  };
  $("#export-save").onclick = () => {
    if (roomClient) {
      toast("連線房間由伺服器管理，無法匯出為離線存檔。");
      return;
    }
    const blob = new Blob([serializeGame(state)], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "labu-city-save.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("#import-save").onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (roomClient) {
      toast("請先離開連線房間再匯入存檔。");
      return;
    }
    try {
      if (file.size > 1_000_000) throw new Error("檔案過大");
      state = deserializeGame(await file.text());
      started = true;
      paused = false;
      save();
      closeModal();
      render();
      schedule();
      toast("已載入存檔");
    } catch (err) {
      toast("存檔無效：" + String(err instanceof Error ? err.message : err));
    }
  };
  $("#new-game").onclick = () => {
    closeModal();
    showLobby();
  };
}

function restoreOffline() {
  const previous = offlineBeforeRoom;
  offlineBeforeRoom = null;
  const client = roomClient;
  roomClient = null;
  room = null;
  networkConnected = false;
  client?.close();
  if (previous) {
    state = previous.state;
    started = previous.started;
    paused = previous.paused;
  }
  render();
  schedule();
}
function connectRoom() {
  if (!roomClient) offlineBeforeRoom = { state, started, paused };
  paused = true;
  clearTimeout(timer);
  roomClient?.close();
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:5174`;
  const client = new RoomClient(hostedTrial ? "/api/rooms" : wsUrl, {
    onSnapshot: (snapshot) => {
      if (roomClient !== client) return;
      room = snapshot;
      networkConnected = true;
      if (snapshot.game) {
        const previousPhase = state.phase,
          previousTick = state.marketTick;
        state = snapshot.game;
        started = true;
        paused = false;
        $("#lobby").classList.remove("visible");
        $("#lobby").innerHTML = "";
        if ($("#room-lobby") || $("#room-form")) closeModal();
        render();
        if (state.marketTick > previousTick) audio.play("step");
        if (state.phase === "finished" && previousPhase !== "finished")
          showResults();
      } else showRoomWaiting();
    },
    onSession: (session) => {
      if (roomClient !== client) return;
      roomSession = session;
      try {
        sessionStorage.setItem("labu-room-session", JSON.stringify(session));
        sessionStorage.setItem("labu-active-game", "room");
      } catch {}
    },
    onError: (message) => toast(message),
    onClose: () => {
      if (roomClient === client) {
        networkConnected = false;
        render();
        toast("房間連線已中斷，可按「邀請好友」重新連線。");
      }
    },
  });
  roomClient = client;
  return client;
}
function showRoomDialog() {
  if (room && networkConnected) {
    showRoomWaiting();
    return;
  }
  let saved: RoomSession | null = roomSession;
  try {
    saved ||= JSON.parse(sessionStorage.getItem("labu-room-session") || "null");
  } catch {}
  showModal(
    modalHeader(
      "BETTER TOGETHER",
      "邀請朋友，一起蓋城市",
      hostedTrial ? "建立房間 → 分享邀請連結 → 朋友入位，空位由 NPC 補齊。" : "本機房間測試 · 兩個瀏覽器可加入同一局。啟動方式：npm run play",
    ) +
      `<form id="room-form"><label class="form-label" for="room-name">你的名字</label><input id="room-name" class="full" maxlength="24" value="${esc(current().name)}" required><label class="form-label" for="room-code">加入房間（已有邀請碼時填寫）</label><input id="room-code" class="full" maxlength="32" value="${esc(invitedRoom)}" placeholder="輸入邀請碼"><div class="form-grid"><label>房間席位<select id="room-seats"><option value="4">4 人</option><option value="3">3 人</option><option value="2">2 人</option></select></label><label>遊戲輪數<select id="room-rounds"><option value="12">12 輪</option><option value="6">6 輪</option><option value="10">10 輪</option><option value="20">20 輪</option><option value="24">24 輪</option></select></label></div><button class="primary full" id="room-submit">建立 / 加入房間 →</button></form>${saved ? '<button class="secondary full" id="room-reconnect">接回上一次房間 →</button>' : ""}<p class="fine-print">${hostedTrial ? "分享連結後，朋友輸入名字即可入位；房主按開始遊戲後，由 NPC 補齊空位。Labu 使用內建遊戲對話，不讀取私人訊息。" : "預設服務只監聽此電腦。跨裝置或公開網路需另行設定主機、HTTPS 與權限。本版不連接真實 Labu 帳號，也不發送 LINE 邀請。"}</p>`,
  );
  $("#room-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>("#room-name").value.trim(),
      code = $<HTMLInputElement>("#room-code").value.trim();
    const seats = Number($<HTMLSelectElement>("#room-seats").value) as
        2 | 3 | 4,
      maxRounds = Number($<HTMLSelectElement>("#room-rounds").value);
    $<HTMLButtonElement>("#room-submit").disabled = true;
    const client = connectRoom();
    try {
      if (code) await client.join({ code, name });
      else
        await client.create({ name, seats, maxRounds, theme: current().theme });
    } catch (err) {
      if (roomClient === client) restoreOffline();
      else client.close();
      toast(err instanceof Error ? err.message : String(err));
      if ($("#room-submit"))
        $<HTMLButtonElement>("#room-submit").disabled = false;
    }
  };
  if (saved)
    $("#room-reconnect").onclick = async () => {
      const client = connectRoom();
      try {
        await client.reconnect(saved!);
      } catch (e) {
        if (roomClient === client) restoreOffline();
        else client.close();
        toast(String(e));
      }
    };
}
let roomStartPending = false;
function showRoomWaiting() {
  if (!room) return;
  const snap = room;
  const invite = new URL(location.href);
  invite.search = '';
  invite.hash = '';
  invite.searchParams.set('room', snap.code);
  const inviteUrl = invite.toString();
  showModal(
    `<div id="room-lobby">${modalHeader("YOUR TABLE IS READY", snap.status === "lobby" ? "朋友到齊，就出發吧" : "連線房間", `房間邀請碼 · ${snap.seats} 席`)}<div class="room-code" style="overflow-wrap:anywhere;font-size:clamp(14px,3vw,22px);letter-spacing:.04em">${esc(snap.code)}</div><label class="form-label" for="invite-link">傳給朋友的邀請連結</label><input id="invite-link" class="full" readonly value="${esc(inviteUrl)}"><button id="copy-code" class="secondary full">複製邀請連結</button><div class="room-members">${Array.from(
      { length: snap.seats },
      (_, i) => {
        const p = snap.players[i];
        return `<div><span class="room-avatar"><img src="${portraits[i]}" alt=""></span><strong>${p ? esc(p.name) : "NPC 補位"}</strong><small>${p ? (p.host ? "房主 · " : "") + (p.connected ? "已連線" : "等待接回") : "開始時自動加入"}</small></div>`;
      },
    ).join(
      "",
    )}</div>${snap.status === "lobby" ? `<button id="room-start" class="primary full" ${snap.selfId === snap.hostId && !roomStartPending ? "" : "disabled"}>${snap.selfId === snap.hostId ? "開始遊戲 · 空位由 NPC 補齊" : "等待房主開始"} →</button>` : '<button id="room-back" class="primary full">返回遊戲 →</button>'}<button id="room-leave" class="resume-button">離開房間，回到本機同桌</button><p class="fine-print">${hostedTrial ? "骰點與股價由房間伺服器統一決定。" : "骰點與股價由本機伺服器統一決定；跨裝置邀請需可連到此主機。"}斷線後由 NPC 暫代，接回會等待安全的回合邊界。</p></div>`,
  );
  $("#copy-code").onclick = () => {
    const input = $<HTMLInputElement>("#invite-link");
    input.focus();
    input.select();
    if (!navigator.clipboard) { toast("請複製已選取的邀請連結"); return; }
    void navigator.clipboard.writeText(inviteUrl)
      .then(() => toast("已複製邀請連結，傳給朋友即可入位"))
      .catch(() => toast("請複製已選取的邀請連結"));
  };
  if ($("#room-start"))
    $("#room-start").onclick = async () => {
      if (roomStartPending || !roomClient) return;
      roomStartPending = true;
      $<HTMLButtonElement>("#room-start").disabled = true;
      try { await roomClient.start(); }
      catch (e) { toast(e instanceof Error ? e.message : String(e)); }
      finally {
        roomStartPending = false;
        if ($("#room-start") && room?.selfId === room?.hostId) $<HTMLButtonElement>("#room-start").disabled = false;
      }
    };
  if ($("#room-back")) $("#room-back").onclick = closeModal;
  $("#room-leave").onclick = () => {
    closeModal();
    showLobby();
    render();
  };
}

function showLobby() {
  try { sessionStorage.setItem("labu-active-game", "lobby"); } catch {}
  if (roomClient) {
    restoreOffline();
    started = false;
  }
  paused = true;
  clearTimeout(timer);
  let hasSave = false;
  try {
    hasSave = !!localStorage.getItem(SAVE_KEY);
  } catch {}
  $("#lobby").classList.add("visible");
  $("#lobby").innerHTML =
    `<section class="lobby-card"><span class="eyebrow">WELCOME TO YOUR LITTLE WORLD</span><h2>把夢想，<br>蓋成一座<span>城市。</span></h2><p>擲出骰子、買下街角的小屋，<br>和朋友一起，成為玩具城市的主人。</p><div class="lobby-character-row">${portraits.map((image, i) => `<img src="${image}" alt="${["小熊", "兔兔", "Labu", "企鵝"][i]}">`).join("")}</div><div class="lobby-features"><span>48 格冒險</span><span>6 間銀行</span><span>每步股票行情</span></div><form id="lobby-form"><div class="form-grid"><label>玩家席位<select id="seat-count"><option value="4">4 人城市</option><option value="3">3 人城市</option><option value="2">2 人城市</option></select></label><label>本機真人<select id="human-count"><option value="1">1 人 + NPC</option><option value="2">2 人同桌</option><option value="3">3 人同桌</option><option value="4">4 人同桌</option></select></label><label>你的名字<input id="player-name" maxlength="16" value="你" required></label><label>遊戲長度<select id="round-count"><option value="12">12 輪 · 標準</option><option value="6">6 輪 · 快速</option><option value="10">10 輪 · 短局</option><option value="20">20 輪 · 長局</option><option value="24">24 輪 · 悠閒</option></select></label></div><label class="form-label">你的建築風格</label><div class="theme-choices">${Object.entries(
      themeNames,
    )
      .map(
        ([id, name], i) =>
          `<label><input type="radio" name="theme" value="${id}" ${i === 0 ? "checked" : ""}><span>${["🍭", "🚀", "🌳", "⚓"][i]}<small>${name}</small></span></label>`,
      )
      .join(
        "",
      )}</div><button class="primary full start-game">開始我的城市冒險 <span>→</span></button></form>${hasSave ? '<button id="resume-game" class="resume-button">繼續上一次的城市 →</button>' : ""}<button id="lobby-room" class="${hostedTrial ? "primary full" : "resume-button"}">${hostedTrial ? "開房間 / 加入朋友 · 線上同樂 →" : "邀請好友 · 本機連線房間 →"}</button><small class="lobby-note">${hostedTrial ? "線上朋友房／離線同桌 · 空位 NPC 補齊 · Labu 內建遊戲對話" : "離線同桌測試版 · 不需登入 · Labu 使用模擬資料"}</small></section>`;
  $("#lobby-room").onclick = showRoomDialog;
  $("#lobby-form").onsubmit = (e) => {
    e.preventDefault();
    const seats = Number($<HTMLSelectElement>("#seat-count").value) as
        2 | 3 | 4,
      humans = Math.min(
        seats,
        Number($<HTMLSelectElement>("#human-count").value),
      );
    const themes = Object.keys(themeNames),
      selected = $<HTMLInputElement>("input[name=theme]:checked").value,
      ordered = [selected, ...themes.filter((t) => t !== selected)];
    state = createGame({
      seed: Date.now(),
      seats,
      maxRounds: Number($<HTMLSelectElement>("#round-count").value),
      players: Array.from({ length: seats }, (_, i) => ({
        name:
          i === 0
            ? $<HTMLInputElement>("#player-name").value.trim() || "你"
            : i < humans
              ? `玩家 ${i + 1}`
              : ["小熊", "兔兔", "Labu", "企鵝"][i],
        isNpc: i >= humans,
        theme: ordered[i] as any,
      })),
    });
    messages = createWelcomeMessages();
    chatDrafts.table = "";
    chatDrafts.private = "";
    labuUsage.clear();
    lastNpcTurn = -1;
    start();
  };
  if (hasSave)
    $("#resume-game").onclick = () => {
      try {
        state = deserializeGame(localStorage.getItem(SAVE_KEY)!);
        start();
      } catch {
        toast("舊存檔無法讀取，請重新開局。");
      }
    };
  $("#seat-count").onchange = () => {
    const select = $<HTMLSelectElement>("#human-count"),
      max = Number($<HTMLSelectElement>("#seat-count").value);
    [...select.options].forEach((o) => (o.disabled = Number(o.value) > max));
    if (Number(select.value) > max) select.value = String(max);
  };
}
function start() {
  try { sessionStorage.setItem("labu-active-game", "offline"); } catch {}
  started = true;
  paused = false;
  $("#lobby").classList.remove("visible");
  $("#lobby").innerHTML = "";
  save();
  render();
  schedule();
}
$("#room-open").onclick = showRoomDialog;
function toggleSound() {
  muted = !audio.toggle();
  $("#sound").textContent = muted ? "♪" : "♫";
  $("#sound").setAttribute("aria-label", muted ? "開啟音效" : "關閉音效");
  audio.play("click");
  $("#sound").setAttribute("title", muted ? "開啟音效" : "關閉音效");
  toast(muted ? "音效已關閉" : "音效已開啟");
}
$("#sound").onclick = toggleSound;
$("#help").onclick = showHelp;
$("#settings").onclick = showSettings;
$("#reset-view").onclick = () => { city?.resetView(); $("#view-menu").removeAttribute("open"); };
$("#follow-view").onclick = () => { city?.setFollow(true); $("#view-menu").removeAttribute("open"); };
$("#mobile-market").onclick = () => { $("#finance-menu").removeAttribute("open"); showMarket(); };
$("#mobile-bank").onclick = () => { $("#finance-menu").removeAttribute("open"); showBank(); };
$("#market-open").onclick = () => showMarket();
$("#board-list").onclick = () => {
  $("#view-menu").removeAttribute("open");
  showModal(
    modalHeader(
      "48 STOPS, ENDLESS STORIES",
      "城市全圖",
      "六處銀行位於 04、12、20、28、36、44 格。",
    ) +
      `<div class="board-directory">${state.tiles.map((t) => `<button data-directory="${t.id}" class="${t.type === "bank" ? "bank" : ""}"><small>${String(t.id + 1).padStart(2, "0")}</small><span>${esc(t.name)}</span>${tileEffectBadge(t.id)}</button>`).join("")}</div>`,
    true,
  );
  document
    .querySelectorAll<HTMLElement>("[data-directory]")
    .forEach(
      (el) => (el.onclick = () => showTile(Number(el.dataset.directory))),
    );
};
$<HTMLDialogElement>("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const r = $("#modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
});
try {
  city = new ToyCity($("#world"), showTile);
  modelAssets = new CityModelAssets(city);
  if (matchMedia("(max-width:760px)").matches) city.setFollow(true);
  $(".world-loading")?.remove();
} catch (err) {
  $("#world").innerHTML =
    '<div class="webgl-fallback"><strong>此裝置無法啟動 3D 顯示</strong><p>仍可使用「48 格地圖」查看棋盤並操作遊戲。請使用支援 WebGL 的瀏覽器。</p></div>';
  console.warn(err);
}
try { document.body.classList.toggle("side-expanded", localStorage.getItem("labu-chat-open") !== "false"); } catch { document.body.classList.add("side-expanded"); }
render();
setSideExpanded(document.body.classList.contains("side-expanded"));
// Restore the same tab's game before presenting a new-game lobby. Room tokens stay
// in sessionStorage and never enter invitation URLs or offline save files.
async function restoreOnLoad() {
  let mode: string | null = null;
  let savedRoom: RoomSession | null = null;
  try {
    mode = sessionStorage.getItem("labu-active-game");
    const candidate = JSON.parse(sessionStorage.getItem("labu-room-session") || "null");
    if (candidate && typeof candidate.code === "string" && typeof candidate.token === "string" && typeof candidate.playerId === "string") savedRoom = candidate;
  } catch {}
  const reload = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload";
  const resume = mode === "offline" || mode === "room" || (reload && mode !== "lobby");
  const differentInvite = invitedRoom && invitedRoom !== savedRoom?.code;
  if (resume && !differentInvite) {
    if (savedRoom && mode !== "offline") {
      roomSession = savedRoom;
      showModal(modalHeader("WELCOME BACK", "正在接回原房間", "請稍候，正在同步玩家與遊戲進度。") + '<div id="room-lobby" role="status">連線中…</div>');
      const client = connectRoom();
      try { await client.reconnect(savedRoom); return; }
      catch {
        if (roomClient === client) restoreOffline();
        showLobby(); showRoomDialog();
        toast("暫時無法接回房間，請按「接回上一次房間」重試。");
        return;
      }
    }
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) { state = deserializeGame(saved); start(); return; }
    } catch { toast("無法讀取上次存檔，請從首頁重新開始。"); }
  }
  showLobby();
  if (invitedRoom && !import.meta.hot?.data.invitationOpened) {
    showRoomDialog();
    if (import.meta.hot) import.meta.hot.data.invitationOpened = true;
  }
}
void restoreOnLoad();
const onPageHide = () => {
  save();
  clearTimeout(timer);
  clearTimeout(Number($("#toast")?.dataset.timer));
  clearTimeout(diceRevealTimer);
  clearInterval(diceShuffleTimer);
  city?.dispose(() => modelAssets?.dispose());
  music.dispose();
  disposeFeedback();
  roomClient?.close();
  void audio.dispose();
};
const onPageShow = (e: PageTransitionEvent) => {
  if (e.persisted) location.reload();
};
window.addEventListener("pagehide", onPageHide);
window.addEventListener("pageshow", onPageShow);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    onPageHide();
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
  });
// Read-only diagnostics help browser QA without exposing commands that alter a game.
Object.defineProperty(window, "__LABU_DIAGNOSTICS__", {
  configurable: true,
  get: () => ({
    phase: state.phase,
    round: state.round,
    turn: state.turn,
    marketTick: state.marketTick,
    tiles: state.tiles.length,
    banks: state.tiles.filter((t) => t.type === "bank").length,
    currentPlayer: state.currentPlayer,
    pendingSteps: state.pendingSteps,
    players: state.players.map((p) => ({
      id: p.id,
      position: p.position,
      bankrupt: p.bankrupt,
    })),
    city: city?.diagnostics(),
    models: modelAssets?.diagnostics(),
    music: music.enabled,
  }),
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .catch(() => console.warn("離線快取未能啟用，遊戲仍可在本機伺服器運作。"));
}
