import { gameCalendar, DIVIDENDS, SEASONS } from './calendar';
import type { Card, GameAction, GameOptions, GameState, Player, Stock, Theme, Tile, TileType, Vehicle } from './game-types';
export type * from './game-types';

export const THEMES: Theme[] = ['candy', 'space', 'forest', 'harbor'];
export const THEME_NAMES: Record<Theme, string> = { candy: '糖果童話', space: '太空科技', forest: '森林自然', harbor: '海港積木' };
export const CARD_NAMES: Record<Card, string> = { loadedDice: '指定骰', rentShield: '免租券', jailFree: '出獄卡', renovation: '遠端建設卡', wanted: '通緝令', steal: '小偷卡', roadblock: '路障卡', trap: '整人陷阱', shutdown: '暫停營業卡', swap: '換位卡', bodyguard: '保鑣卡' };
export const CARD_PRICES: Record<Card, number> = { loadedDice: 180, rentShield: 250, jailFree: 200, renovation: 320, wanted: 450, steal: 250, roadblock: 150, trap: 200, shutdown: 300, swap: 350, bodyguard: 200 };
export const HAND_LIMIT = 5;
export const ATTACK_CARDS: readonly Card[] = ['wanted', 'steal', 'roadblock', 'trap', 'shutdown', 'swap'];
export const CARD_DESCRIPTIONS: Record<Card, string> = {
  loadedDice: '擲骰前指定第一顆骰子點數。', rentShield: '自動抵擋一次租金。', jailFree: '立即解除服刑。', renovation: '免費升級一棟自己的地產。',
  wanted: '指定自由對手入獄，錯過一次擲骰；可保釋或出獄卡，獲得 2 輪通緝保護。',
  steal: '偷取對手現金 10%，最多 30 萬元，不動銀行存款。',
  roadblock: '放置路障，第一位經過者立即停下並觸發該格；一圈回合後失效。',
  trap: '放在無主地，第一位經過者支付最多 15 萬元現金給你；一圈回合後失效。',
  shutdown: '對手地產停止收租，直到你的下一回合開始。',
  swap: '與自由對手交換位置，不觸發落地事件或起點獎金。', bodyguard: '自動抵擋一次通緝令或小偷卡。',
};
export const BANK_POSITIONS = [3, 11, 19, 27, 35, 43];
export const START_SALARY = 800;
export const BAIL_COST = 300;
/** Prices are fictional game prices. Models within a dice tier differ visually only. */
export const VEHICLES: readonly Vehicle[] = [
  { id: 'bicycle', name: '彩虹腳踏車', price: 350, diceCount: 2, kind: 'bike', color: '#ffb760' },
  { id: 'scooter', name: '薄荷機車', price: 650, diceCount: 2, kind: 'scooter', color: '#62d9bc' },
  { id: 'city-car', name: '積木城市小車', price: 1800, diceCount: 3, kind: 'car', color: '#ff8d70' },
  { id: 'tesla-model-3', name: 'Tesla Model 3 玩具車', price: 2400, diceCount: 3, kind: 'car', color: '#edf3ff' },
  { id: 'tesla-model-y', name: 'Tesla Model Y 玩具車', price: 3000, diceCount: 3, kind: 'car', color: '#7db5eb' },
];
export function getDiceCount(player: Player): 1 | 2 | 3 { return VEHICLES.find(v => v.id === player.vehicleId)?.diceCount ?? 1; }
const COLORS = ['#ff839c', '#59b9f0', '#7bc69d', '#f5be62'];
const STOCK_NAMES = ['積木玩具', '甜甜餐飲', '雲朵交通', '小城建設', '星際科技', '歡樂娛樂'];
const PROPERTY_NAMES = ['奶油小街', '棉花糖巷', '彩虹大道', '餅乾廣場', '星光小徑', '火箭街', '月球大道', '銀河商圈', '橡果小巷', '松果步道', '森林大道', '花園街', '海風小街', '貝殼巷', '港灣大道', '燈塔街', '積木小路', '玩具商店街', '旋轉木馬街', '夢想大道', '雲朵小街', '晴空大道', '日光廣場', '城市之心'];
const SPECIAL: Record<number, [TileType, string]> = {
  0: ['start', '市政廣場'], 3: ['bank', '糖果銀行'], 5: ['event', '機會廣場'], 7: ['shop', '奇趣道具店'], 9: ['station', '彩虹車站'], 11: ['bank', '星際銀行'],
  12: ['prison', '玩具監獄'], 15: ['event', '命運廣場'], 17: ['amusement', '摩天輪樂園'], 19: ['bank', '森林銀行'], 21: ['park', '橡果公園'], 23: ['tax', '稅務局'],
  24: ['police', '城市警察局'], 27: ['bank', '海港銀行'], 29: ['event', '城市新聞'], 31: ['shop', '積木道具店'], 33: ['station', '海風車站'], 35: ['bank', '積木銀行'],
  36: ['auction', '拍賣中心'], 39: ['event', '幸運廣場'], 41: ['amusement', '旋轉木馬樂園'], 43: ['bank', '晴空銀行'], 45: ['park', '雲朵公園'], 47: ['construction', '城市建設中心'],
};

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function integer(value: number, min = 1) { assert(Number.isSafeInteger(value) && value >= min, '數值必須是有效的整數'); }
function soldCostBasis(totalBasis: number, holding: number, quantity: number): number {
  // Integer rounding avoids precision loss from multiplying large imported holdings.
  return Number((BigInt(totalBasis) * BigInt(quantity) * 2n + BigInt(holding)) / (BigInt(holding) * 2n));
}
function log(s: GameState, text: string) { s.log.push({ id: s.nextLogId++, round: s.round, text }); if (s.log.length > 250) s.log.shift(); }
function hashSeed(seed: string) { let n = 2166136261; for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0 || 1; }
function random(s: GameState) { let x = s.rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rngState = x >>> 0 || 1; return s.rngState / 4294967296; }
function rollInt(s: GameState, sides: number) { return Math.floor(random(s) * sides); }
function active(s: GameState) { return s.players[s.currentPlayer]; }
export function formatMoney(amount: number): string { return `${(amount / 10).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 萬元`; }
export const DISTRICT_NAMES = ['糖果街區', '星際街區', '森林街區', '海港街區', '積木街區', '晴空街區'];
export function ownsDistrict(s: GameState, tile: Tile): boolean {
  const group = s.tiles.filter(t => t.type === 'property' && t.district === tile.district);
  return !!tile.ownerId && group.length > 0 && group.every(t => t.ownerId === tile.ownerId);
}
export function getRent(tile: Tile, s?: GameState): number { return s && (tile.closedUntilTurn ?? 0) > s.turn ? 0 : Math.round(tile.price * [0.12, 0.25, 0.48, 0.8][tile.level] * (s && ownsDistrict(s, tile) ? 1.5 : 1)); }
export function getUpgradeCost(s: GameState, tile: Tile): number { return Math.round(tile.upgradeCost * (ownsDistrict(s, tile) ? .8 : 1)); }
export const CITY_GOALS = [
  { id: 'neighborhood', name: '街區收藏家', detail: '同時擁有一個完整街區的所有地產', reward: 400 },
  { id: 'builder', name: '夢想建築師', detail: '同時擁有兩棟 2 級以上建築', reward: 600 },
  { id: 'investor', name: '多元投資家', detail: '同時持有三支股票，每支至少 5 張', reward: 350 },
] as const;
export function goalProgress(s: GameState, p: Player, id: string): { value: number; target: number } {
  const own = s.tiles.filter(t => t.ownerId === p.id);
  if (id === 'neighborhood') return { value: own.some(t => ownsDistrict(s, t)) ? 1 : 0, target: 1 };
  if (id === 'builder') return { value: Math.min(2, own.filter(t => t.level >= 2).length), target: 2 };
  return { value: Math.min(3, s.stocks.filter(t => p.holdings[t.id] >= 5).length), target: 3 };
}
export function getNetWorth(s: GameState, p: Player): number {
  return p.cash + p.deposit + s.stocks.reduce((sum, st) => sum + st.price * (p.holdings[st.id] ?? 0), 0)
    + s.tiles.filter(t => t.ownerId === p.id).reduce((sum, t) => sum + t.price + t.level * t.upgradeCost, 0)
    + p.vehicles.reduce((sum, id) => sum + Math.floor((VEHICLES.find(v => v.id === id)?.price ?? 0) / 2), 0);
}
export function getRankings(s: GameState) { return [...s.players].sort((a, b) => Number(a.bankrupt) - Number(b.bankrupt) || getNetWorth(s, b) - getNetWorth(s, a) || a.id.localeCompare(b.id)); }
function assertFinancialSafety(s: GameState) {
  let totalWealth = 0;
  for (const p of s.players) {
    integer(p.cash, 0); integer(p.deposit, 0); assert(Number.isSafeInteger(p.realizedProfit), '損益超過安全計算範圍');
    for (const st of s.stocks) { integer(p.holdings[st.id], 0); integer(p.costBasis[st.id], 0); }
    const wealth = getNetWorth(s, p); integer(wealth, 0); totalWealth += wealth; integer(totalWealth, 0);
  }
}
export function createGame(options: GameOptions = {}): GameState {
  const seats = options.seats ?? 4; assert([2, 3, 4].includes(seats), '玩家席位必須介於 2 至 4');
  const maxRounds = options.maxRounds ?? 12; integer(maxRounds); assert(maxRounds <= 100, '最多 100 輪');
  const configs = options.players ?? (options.humanNames ?? ['玩家']).map(name => ({ name, isNpc: false, theme: undefined }));
  assert(configs.length >= 1 && configs.length <= seats, '玩家數量必須介於 1 至房間席位數');
  configs.forEach(c => { assert(typeof c.name === 'string' && c.name.trim().length > 0 && c.name.length <= 24, '玩家名稱須為 1 至 24 字'); assert(c.theme === undefined || THEMES.includes(c.theme), '無效建築主題'); });
  const all = [...configs]; while (all.length < seats) all.push({ name: all.some(p => p.name === 'Labu') ? `玩具夥伴 ${all.length + 1}` : 'Labu', isNpc: true, theme: THEMES[all.length] });
  const seed = String(options.seed ?? Date.now());
  let property = 0;
  const tiles: Tile[] = Array.from({ length: 48 }, (_, id) => {
    const special = SPECIAL[id]; const district = Math.floor(id / 8);
    return { id, type: special?.[0] ?? 'property', name: special?.[1] ?? PROPERTY_NAMES[property++], district, price: special ? 0 : 900 + district * 180 + (id % 3) * 70, upgradeCost: special ? 0 : 400 + district * 80, ownerId: null, level: 0 };
  });
  const stocks: Stock[] = STOCK_NAMES.map((name, i) => ({ id: `stock-${i}`, name, price: [30, 45, 55, 65, 85, 40][i], previousPrice: [30, 45, 55, 65, 85, 40][i], history: [[30, 45, 55, 65, 85, 40][i]], volatility: [20, 16, 18, 24, 38, 30][i] }));
  const s: GameState = {
    version: 2, seed, rngState: hashSeed(seed), players: all.map((p, i) => ({ id: `player-${i}`, name: p.name.trim(), isNpc: !!p.isNpc, theme: p.theme ?? THEMES[i], color: COLORS[i], position: 0, cash: 4000, deposit: 2000, holdings: Object.fromEntries(stocks.map(st => [st.id, 0])), costBasis: Object.fromEntries(stocks.map(st => [st.id, 0])), realizedProfit: 0, dividendsReceived: 0, personality: (['balanced', 'cautious', 'balanced', 'bold'] as const)[i], cards: [], completedGoals: [], vehicles: [], vehicleId: null, jailTurns: 0, bankrupt: false })),
    currentPlayer: 0, phase: 'roll', turn: 1, round: 1, maxRounds, marketTick: 0, stocks, tiles, log: [], nextLogId: 1,
    winner: null, die: null, dice: [], pendingSteps: 0, nextDice: null, performedActions: [], auctionTileId: null, arrivalMessage: '歡迎來到玩具城市，擲骰開始冒險！', marketTrend: 0, trendSteps: 0,
  };
  log(s, `${seats} 位玩家抵達玩具城市，本局共 ${maxRounds} 輪。`); return s;
}

function finishGame(s: GameState) { s.phase = 'finished'; s.pendingSteps = 0; s.winner = getRankings(s)[0].id; log(s, `遊戲結束！${s.players.find(p => p.id === s.winner)!.name} 取得第一名。`); }
function checkElimination(s: GameState) { if (s.players.filter(p => !p.bankrupt).length <= 1) finishGame(s); }
function payRequired(s: GameState, p: Player, amount: number, reason: string, recipient?: Player) {
  integer(amount, 0);
  if (p.cash < amount && p.deposit > 0) { const draw = Math.min(p.deposit, amount - p.cash); p.deposit -= draw; p.cash += draw; log(s, `${p.name} 自動從存款補足 ${formatMoney(draw)}。`); }
  if (p.cash < amount) {
    log(s, `${p.name} 現金與存款不足，進入資產清算。`);
    for (const stock of s.stocks) {
      if (p.cash >= amount) break;
      const quantity = Math.min(p.holdings[stock.id], Math.ceil((amount - p.cash) / stock.price));
      if (quantity > 0) { const basis = soldCostBasis(p.costBasis[stock.id], p.holdings[stock.id], quantity); p.costBasis[stock.id] -= basis; p.realizedProfit += quantity * stock.price - basis; p.holdings[stock.id] -= quantity; p.cash += quantity * stock.price; log(s, `清算 ${p.name} 的 ${stock.name} ${quantity} 張。`); }
    }
    for (const vehicleId of [...p.vehicles]) {
      if (p.cash >= amount) break;
      const vehicle = VEHICLES.find(v => v.id === vehicleId)!;
      p.cash += Math.floor(vehicle.price / 2); p.vehicles = p.vehicles.filter(id => id !== vehicleId);
      if (p.vehicleId === vehicleId) p.vehicleId = null;
      log(s, `${p.name} 的${vehicle.name}以購入價五折清算。`);
    }
    for (const tile of s.tiles.filter(t => t.ownerId === p.id)) {
      if (p.cash >= amount) break;
      p.cash += Math.floor((tile.price + tile.upgradeCost * tile.level) / 2); tile.ownerId = null; tile.level = 0; log(s, `${p.name} 的 ${tile.name} 以原建置成本五折清算。`);
    }
  }
  const paid = Math.min(p.cash, amount); p.cash -= paid; if (recipient) recipient.cash += paid;
  log(s, `${p.name} → ${recipient ? recipient.name : "城市公庫"}：${formatMoney(paid)}（${reason}）${recipient ? "，對方收到租金" : ""}。`);
  if (paid < amount) { p.bankrupt = true; p.jailTurns = 0; p.wantedSkip = false; p.cards = []; s.hazards = (s.hazards ?? []).filter(h => h.ownerId !== p.id); for (const tile of s.tiles) if (tile.closedById === p.id) { delete tile.closedUntilTurn; delete tile.closedById; } log(s, `${p.name} 無法清償，宣告破產。`); checkElimination(s); }
}
/** Settle only when every surviving seat has finished the round, including the final round. */
function settleCalendarRound(s: GameState) {
  for (const p of s.players) if (!p.bankrupt && p.jailTurns > 0 && !p.wantedSkip) {
    p.jailTurns--;
    if (p.jailTurns === 0) log(s, `${p.name} 刑期屆滿，下一次擲骰恢復行動。`);
  }
  if (s.round % 2 !== 0) return;
  const calendar = gameCalendar(s.round);
  s.stocks.forEach((stock, index) => {
    const schedule = DIVIDENDS[index];
    if (schedule.season !== calendar.seasonIndex) return;
    // Cancel at the price floor; do not create wealth by clamping an ex-dividend price.
    const dividend = stock.price - schedule.perShare >= 5 ? schedule.perShare : 0;
    if (!dividend) { log(s, `${stock.name} 本季因股價過低暫停配息。`); return; }
    stock.previousPrice = stock.price;
    stock.price -= dividend;
    stock.history.push(stock.price);
    if (stock.history.length > 48) stock.history.shift();
    log(s, `${stock.name} ${SEASONS[schedule.season]}季末除息：每股 ${dividend} 元，每張 ${formatMoney(dividend)}；除息參考價 ${stock.price} 元／股。`);
    for (const p of s.players) if (!p.bankrupt && p.holdings[stock.id] > 0) {
      const income = p.holdings[stock.id] * dividend;
      p.deposit += income;
      p.dividendsReceived = (p.dividendsReceived ?? 0) + income;
      log(s, `${stock.name} → ${p.name}的銀行存款：${formatMoney(income)}（${p.holdings[stock.id]} 張股票股利）。`);
    }
  });
  if (s.round < s.maxRounds) {
    const next = gameCalendar(s.round + 1);
    log(s, `換季：第 ${next.year} 年${next.season}季，每季 2 輪。`);
  }
}
function spend(p: Player, amount: number) { integer(amount, 0); assert(p.cash >= amount, '手上現金不足，可先在銀行提款'); p.cash -= amount; }
function updateMarket(s: GameState) {
  for (const stock of s.stocks) { stock.previousPrice = stock.price; const perMille = (random(s) * 2 - 1) * stock.volatility + (s.trendSteps > 0 ? s.marketTrend : 0); stock.price = Math.max(5, Math.min(100000, stock.price + Math.round(stock.price * perMille / 1000))); stock.history.push(stock.price); if (stock.history.length > 48) stock.history.shift(); }
  s.marketTick++; if (s.trendSteps > 0 && --s.trendSteps === 0) s.marketTrend = 0;
}
function arrive(s: GameState) {
  const p = active(s); const tile = s.tiles[p.position]; s.phase = 'action'; s.arrivalMessage = `${p.name} 抵達 ${tile.name}。`; log(s, s.arrivalMessage);
  if (tile.type === 'bank' && (p.mobileBankUses ?? 0) > 0) { p.mobileBankUses = 0; log(s, `${p.name} 的提款卡已在銀行自動補滿 3 次遠端存提款。`); }
  if (tile.type === 'property' && tile.ownerId && tile.ownerId !== p.id) {
    const shield = p.cards.indexOf('rentShield');
    if (getRent(tile, s) === 0) { log(s, `${tile.name} 暫停營業，本次不收租。`); return; }
    if (shield >= 0) { p.cards.splice(shield, 1); log(s, `${p.name} 自動使用免租券，本次免租。`); }
    else payRequired(s, p, getRent(tile, s), '繳交租金', s.players.find(other => other.id === tile.ownerId));
  } else if (tile.type === 'police') { p.position = 12; p.jailTurns = 2; s.arrivalMessage = '違規事件：送入監獄，服刑 2 輪（入獄當輪計入），每完成一輪減少一輪。'; log(s, s.arrivalMessage); }
  else if (tile.type === 'tax') payRequired(s, p, Math.max(100, Math.floor(getNetWorth(s, p) * .035)), '繳納城市稅');
  else if (tile.type === 'park') { p.cash += 150; log(s, `城市公庫 → ${p.name}：${formatMoney(150)}（公園活動獎勵）。`); }
  else if (tile.type === 'event') {
    const event = rollInt(s, 5);
    if (event === 0) { p.cash += 350; log(s, `城市公庫 → ${p.name}：${formatMoney(350)}（城市創意獎）。`); }
    else if (event === 1) payRequired(s, p, 200, '支付房屋保養費');
    else if (event === 2) { if (p.cards.length < HAND_LIMIT) { p.cards.push('jailFree'); log(s, `${p.name} 獲得出獄卡。`); } else { p.cash += 200; log(s, `${p.name} 背包已滿，出獄卡折換為 ${formatMoney(200)}。`); } }
    else { s.marketTrend = event === 3 ? 10 : -10; s.trendSteps = 12; log(s, `城市新聞：市場${event === 3 ? '樂觀' : '保守'}氣氛持續接下來 12 步；股價仍只在走格時更新。`); }
  } else if (tile.type === 'auction') { s.auctionTileId = s.tiles.find(t => t.type === 'property' && !t.ownerId)?.id ?? null; }
}
function triggerHazards(s: GameState) {
  const p = active(s);
  const hit = (s.hazards ?? []).find(h => h.tileId === p.position && h.expiresTurn > s.turn);
  if (!hit) return;
  s.hazards = (s.hazards ?? []).filter(h => h !== hit);
  if (hit.kind === 'roadblock') { s.pendingSteps = 0; log(s, `${p.name} 遇到路障，提前停下。`); }
  else {
    const owner = s.players.find(other => other.id === hit.ownerId);
    if (owner && !owner.bankrupt) { const amount = Math.min(p.cash, 150); p.cash -= amount; owner.cash += amount; log(s, `${p.name} → ${owner.name}：${formatMoney(amount)}（踩中整人陷阱）。`); }
  }
}
function useAttack(s: GameState, p: Player, action: Extract<GameAction, { type: 'useCard' }>) {
  assert(p.jailTurns === 0, '服刑期間不能使用攻擊卡');
  once(s, 'attack');
  const duration = s.players.filter(other => !other.bankrupt).length;
  if (action.card === 'roadblock' || action.card === 'trap') {
    integer(action.tileId ?? -1, 0); const tile = s.tiles[action.tileId!];
    assert(tile && tile.id !== p.position, '請選擇其他道路格');
    if (action.card === 'roadblock') assert((tile.id - p.position + 48) % 48 <= 12, '路障須放在前方 1 至 12 格');
    assert(action.card !== 'trap' || tile.type === 'property' && !tile.ownerId, '陷阱只能放在無主地');
    assert(!(s.hazards ?? []).some(h => h.tileId === tile.id && h.expiresTurn > s.turn), '該格已有道具');
    s.hazards = [...(s.hazards ?? []), { tileId: tile.id, ownerId: p.id, kind: action.card, expiresTurn: s.turn + duration }];
    log(s, `${p.name} 在 ${tile.name} 放置${CARD_NAMES[action.card]}。`); return;
  }
  if (action.card === 'shutdown') {
    integer(action.tileId ?? -1, 0); const tile = s.tiles[action.tileId!];
    assert(tile?.type === 'property' && tile.ownerId && tile.ownerId !== p.id && (tile.closedUntilTurn ?? 0) <= s.turn, '請選擇營業中的對手地產');
    tile.closedUntilTurn = s.turn + duration; tile.closedById = p.id; log(s, `${tile.name} 暫停營業，直到 ${p.name} 下次回合。`); return;
  }
  const target = s.players.find(other => other.id === action.targetId);
  assert(target && target.id !== p.id && !target.bankrupt, '請選擇其他未破產玩家');
  if (action.card === 'wanted') assert(target.jailTurns === 0 && (target.wantedImmuneUntilRound ?? 0) <= s.round, '對手正在服刑或通緝保護中');
  if (action.card === 'swap') assert(target.jailTurns === 0, '不能與服刑中的玩家換位');
  if (action.card === 'steal') assert(target.cash > 0, '對手沒有現金可偷');
  if (action.card === 'wanted' || action.card === 'steal') {
    const guard = target.cards.indexOf('bodyguard');
    if (guard >= 0) { target.cards.splice(guard, 1); log(s, `${target.name} 的保鑣擋下 ${p.name} 的${CARD_NAMES[action.card]}！`); return; }
  }
  if (action.card === 'wanted') { target.position = 12; target.jailTurns = 1; target.wantedSkip = true; target.wantedImmuneUntilRound = s.round + 2; log(s, `${target.name} 被通緝入獄，將錯過一次移動。`); }
  else if (action.card === 'steal') { const amount = Math.min(300, Math.floor(target.cash / 10)); target.cash -= amount; p.cash += amount; log(s, `${target.name} → ${p.name}：${formatMoney(amount)}（小偷卡偷取現金）。`); }
  else if (action.card === 'swap') { [p.position, target.position] = [target.position, p.position]; s.auctionTileId = null; s.arrivalMessage = `${p.name} 與 ${target.name} 交換位置，不觸發落地事件。`; log(s, s.arrivalMessage); }
}
function at(s: GameState, type: TileType) { assert(s.phase === 'action' && s.tiles[active(s).position].type === type, `必須停在${type === 'bank' ? '銀行' : '對應設施'}才能進行此操作`); }
function once(s: GameState, action: string) { assert(!s.performedActions.includes(action), '本回合已使用此設施'); s.performedActions.push(action); }

export function isRemoteFinanceAction(action: {type?: string} | null | undefined): boolean { return !!action && ['deposit','withdraw','buyStock','sellStock'].includes(action.type ?? ''); }
function useBank(s:GameState,p:Player) {
  const onBank = s.tiles[p.position].type === 'bank' && !(p.id === active(s).id && s.phase === 'moving');
  if (!onBank) { assert((p.mobileBankUses ?? 0) < 3, '提款卡 3 次已用完，請停到銀行自動補滿'); p.mobileBankUses = (p.mobileBankUses ?? 0) + 1; }
}
function updatePropertyMarket(s:GameState) {
  if (s.round % 2 !== 0 || s.round >= s.maxRounds) return;
  const changes = Array.from({length:DISTRICT_NAMES.length},(_,district)=>{ const n=hashSeed(`${s.seed}:${s.round}:${district}:housing`); return {district,percent:n%4===0 ? -(2+(n>>>4)%4) : 2+(n>>>4)%5}; });
  for(const tile of s.tiles) if(tile.type === 'property') {
    const base=900+tile.district*180+(tile.id%3)*70;
    tile.price=Math.max(Math.round(base*.5),Math.min(base*3,Math.round(tile.price*(1+changes[tile.district].percent/100))));
  }
  s.propertyReport={round:s.round+1,changes};
  log(s, `房市更新：${changes.filter(c=>c.percent>0).length} 區上漲、${changes.filter(c=>c.percent<0).length} 區下跌；地產售價、估值與租金依新行情計算。`);
}

/** Pure reducer. Rejected actions throw without changing the input state. */
export function dispatch(state: GameState, action: GameAction): GameState {
  assert(state.phase !== 'finished', '本局已結束');
  assert(action && typeof action.type === 'string', '無效操作');
  if (action.actorId !== undefined && !isRemoteFinanceAction(action)) assert(action.actorId === active(state).id, '現在不是你的回合');
  const s: GameState = structuredClone(state); const p = action.actorId && isRemoteFinanceAction(action) ? s.players.find(p=>p.id===action.actorId)! : active(s);
  assert(p, '找不到玩家');
  assert(!p.bankrupt || action.type === 'finishTurn', '破產玩家不可行動');
  switch (action.type) {
    case 'roll': {
      assert(s.phase === 'roll', '現在不能擲骰');
      if (p.jailTurns > 0) { if (p.wantedSkip) { p.wantedSkip = false; p.jailTurns = 0; s.die = 0; s.dice = []; s.phase = 'action'; s.arrivalMessage = '通緝令：本次不能移動，刑期已完成。'; log(s, `${p.name} ${s.arrivalMessage}`); break; } s.die = 0; s.dice = []; s.phase = 'action'; s.arrivalMessage = `本回合留在監獄，剩餘 ${p.jailTurns} 輪；可保釋，或等遊戲日曆推進。`; log(s, `${p.name} ${s.arrivalMessage}`); break; }
      s.dice = Array.from({ length: getDiceCount(p) }, (_, index) => index === 0 && s.nextDice !== null ? s.nextDice : 1 + rollInt(s, 6));
      s.die = s.dice.reduce((sum, value) => sum + value, 0); s.nextDice = null; s.pendingSteps = s.die; s.phase = 'moving'; log(s, `${p.name} 擲出 ${s.dice.join('＋')}，共前進 ${s.die} 格。`); break;
    }
    case 'step': assert(s.phase === 'moving' && s.pendingSteps > 0, '目前沒有待移動的步數'); p.position = (p.position + 1) % 48; s.pendingSteps--; updateMarket(s); if (p.position === 0) { p.cash += START_SALARY; log(s, `城市公庫 → ${p.name}：${formatMoney(START_SALARY)}（經過起點獎勵）。`); } triggerHazards(s); if (s.pendingSteps === 0) arrive(s); break;
    case 'buy': { at(s, 'property'); const tile = s.tiles[p.position]; assert(!tile.ownerId, '此地產已有主人'); spend(p, tile.price); tile.ownerId = p.id; log(s, `${p.name} → 地產中心：${formatMoney(tile.price)}（買下 ${tile.name}）。`); break; }
    case 'upgrade': {
      assert(s.phase === 'action', '目前不能建造'); const tile = s.tiles[action.tileId ?? p.position];
      assert(tile?.type === 'property' && tile.ownerId === p.id, '只能升級自己的地產');
      assert(tile.id === p.position || s.tiles[p.position].type === 'construction', '必須停在自己的地產或建設中心');
      once(s, 'upgrade'); assert(tile.level < 3, '建築已達最高等級'); const cost = getUpgradeCost(s, tile); spend(p, cost); tile.level++; log(s, `${p.name} → 建設公司：${formatMoney(cost)}；${tile.name} 升為 ${tile.level} 級${THEME_NAMES[p.theme]}建築。`); break;
    }
    case 'deposit': useBank(s,p); integer(action.amount); spend(p, action.amount); p.deposit += action.amount; log(s, `${p.name} 現金 → 自己的銀行存款：${formatMoney(action.amount)}（存款）。`); break;
    case 'withdraw': useBank(s,p); integer(action.amount); assert(p.deposit >= action.amount, '存款不足'); p.deposit -= action.amount; p.cash += action.amount; log(s, `${p.name} 銀行存款 → 自己的現金：${formatMoney(action.amount)}（提款）。`); break;
    case 'buyStock': case 'sellStock': {
      integer(action.quantity); const stock = s.stocks.find(st => st.id === action.stockId); assert(stock, '找不到此股票'); if(action.expectedPrice !== undefined) assert(action.expectedPrice === stock.price,'股價已更新，請確認新報價後重試'); const total = stock.price * action.quantity; integer(total);
      if (action.type === 'buyStock') { assert(p.deposit >= total, '存款不足，股票使用銀行存款交易'); p.deposit -= total; p.holdings[stock.id] += action.quantity; p.costBasis[stock.id] += total; }
      else { assert(p.holdings[stock.id] >= action.quantity, '持股不足'); const basis = soldCostBasis(p.costBasis[stock.id], p.holdings[stock.id], action.quantity); p.costBasis[stock.id] -= basis; p.realizedProfit += total - basis; p.holdings[stock.id] -= action.quantity; p.deposit += total; }
      log(s, `${action.type === "buyStock" ? p.name + "的存款 → 交易所" : "交易所 → " + p.name + "的存款"}：${formatMoney(total)}；${action.type === "buyStock" ? "買進" : "賣出"} ${stock.name} ${action.quantity} 張。`); break;
    }
    case 'station': { at(s, 'station'); once(s, 'station'); spend(p, 100); p.position = p.position === 9 ? 33 : 9; s.arrivalMessage = `搭乘玩具列車抵達 ${s.tiles[p.position].name}，不觸發沿途格子。`; log(s, `${p.name} → 車站：${formatMoney(100)}；${s.arrivalMessage}`); break; }
    case 'shop': at(s, 'shop'); assert(Object.hasOwn(CARD_PRICES, action.card), '無效道具'); once(s, 'shop'); assert(p.cards.length < HAND_LIMIT, '道具背包已滿'); spend(p, CARD_PRICES[action.card]); p.cards.push(action.card); log(s, `${p.name} → 道具商店：${formatMoney(CARD_PRICES[action.card])}（購買${CARD_NAMES[action.card]}）。`); break;
    case 'buyVehicle': {
      at(s, 'shop'); const vehicle = VEHICLES.find(v => v.id === action.vehicleId); assert(vehicle, '找不到此交通工具');
      assert(!p.vehicles.includes(vehicle.id), '已經擁有此交通工具'); once(s, 'buyVehicle'); spend(p, vehicle.price); p.vehicles.push(vehicle.id);
      log(s, `${p.name} → 車行：${formatMoney(vehicle.price)}（購買${vehicle.name}）；下次擲骰前可在車庫換乘。`); break;
    }
    case 'equipVehicle': {
      assert(s.phase === 'roll' && p.jailTurns === 0, '只能在自由行動的擲骰前換乘');
      assert(action.vehicleId === null || p.vehicles.includes(action.vehicleId), '只能換乘自己擁有的交通工具');
      assert(action.vehicleId !== p.vehicleId, '已經使用此交通方式'); p.vehicleId = action.vehicleId;
      log(s, `${p.name} 改為${p.vehicleId ? VEHICLES.find(v => v.id === p.vehicleId)!.name : '步行'}，使用 ${getDiceCount(p)} 顆骰子。`); break;
    }
    case 'useCard': {
      assert(s.phase === 'roll' || s.phase === 'action', '移動期間不能使用道具'); const index = p.cards.indexOf(action.card); assert(index >= 0, '你沒有這張道具卡');
      if (action.card === 'jailFree') { assert(p.jailTurns > 0, '目前不在服刑'); p.jailTurns = 0; p.wantedSkip = false; }
      else if (action.card === 'loadedDice') { assert(s.phase === 'roll' && p.jailTurns === 0 && s.nextDice === null, '指定骰只能在自由行動的擲骰前使用'); integer(action.value ?? 0); assert(action.value! <= 6, '指定點數必須介於 1 至 6'); s.nextDice = action.value!; }
      else if (action.card === 'renovation') {
        assert(s.phase === 'action' && p.jailTurns === 0, '遠端建設卡只能在自由行動的抵達階段使用');
        const tile = s.tiles[action.tileId ?? -1]; assert(tile?.type === 'property' && tile.ownerId === p.id && tile.level < 3, '請選擇自己未滿級的地產');
        once(s, 'upgrade'); tile.level++; log(s, `${p.name} 遠端將 ${tile.name} 升為 ${tile.level} 級，免付建設費。`);
      }
      else if (ATTACK_CARDS.includes(action.card)) useAttack(s, p, action);
      else throw new Error('免租券與保鑣卡會自動使用');
      p.cards.splice(index, 1); log(s, `${p.name} 使用${CARD_NAMES[action.card]}${action.card === 'loadedDice' ? '，指定第一顆骰子，其餘骰子照常隨機' : ''}。`); break;
    }
    case 'claimGoal': {
      assert(s.phase === 'roll' || s.phase === 'action', '移動期間不能領取獎勵');
      const goal = CITY_GOALS.find(g => g.id === action.goalId); assert(goal, '找不到城市目標');
      assert(!p.completedGoals.includes(goal.id), '這個目標已領取');
      const progress = goalProgress(s, p, goal.id); assert(progress.value >= progress.target, '尚未達成城市目標');
      p.completedGoals.push(goal.id); p.cash += goal.reward; log(s, `${p.name} 完成「${goal.name}」，獲得 ${formatMoney(goal.reward)}。`); break;
    }
    case 'bail': assert((s.phase === 'roll' || s.phase === 'action') && p.jailTurns > 0, '目前不能保釋'); spend(p, BAIL_COST); p.jailTurns = 0; p.wantedSkip = false; log(s, `${p.name} → 警察局：${formatMoney(BAIL_COST)}（保釋離開）。`); break;
    case 'amusement': { at(s, 'amusement'); once(s, 'amusement'); spend(p, 100); const reward = [0, 100, 200, 400][rollInt(s, 4)]; p.cash += reward; log(s, `${p.name} 花費 ${formatMoney(100)} 玩幸運轉盤，獲得 ${formatMoney(reward)}。`); break; }
    case 'auction': {
      at(s, 'auction'); once(s, 'auction'); integer(action.bid); const tile = s.tiles[s.auctionTileId ?? -1]; assert(tile && !tile.ownerId, '目前沒有可拍賣地產'); assert(action.bid >= Math.floor(tile.price * .65), '出價低於起標價'); assert(p.cash >= action.bid, '出價超過手上現金');
      let winner = p; let winningBid = action.bid;
      for (const other of s.players) if (other.id !== p.id && other.isNpc && !other.bankrupt && other.cash > tile.price + 600) { const offer = Math.floor(tile.price * (.65 + random(s) * .45)); if (offer > winningBid) { winner = other; winningBid = offer; } }
      spend(winner, winningBid); tile.ownerId = winner.id; s.auctionTileId = null; log(s, `${winner.name} 以 ${formatMoney(winningBid)} 標下 ${tile.name}（本格訪客與 NPC 競標）。`); break;
    }
    case 'finishTurn': {
      assert(s.phase === 'action', '完成移動後才能結束回合'); if (s.players.filter(other => !other.bankrupt).length <= 1) { finishGame(s); break; }
      let next = s.currentPlayer; do { next = (next + 1) % s.players.length; if (next === 0) { settleCalendarRound(s); updatePropertyMarket(s); s.round++; } } while (s.players[next].bankrupt);
      if (s.round > s.maxRounds) { s.round = s.maxRounds; finishGame(s); break; }
      s.currentPlayer = next; s.turn++; s.hazards = (s.hazards ?? []).filter(h => h.expiresTurn > s.turn && !s.players.find(p => p.id === h.ownerId)?.bankrupt); for (const tile of s.tiles) if ((tile.closedUntilTurn ?? 0) <= s.turn || tile.closedById === active(s).id || s.players.find(p => p.id === tile.closedById)?.bankrupt) { delete tile.closedUntilTurn; delete tile.closedById; } s.phase = 'roll'; s.die = null; s.dice = []; s.nextDice = null; s.performedActions = []; s.auctionTileId = null; s.arrivalMessage = `輪到 ${active(s).name} 擲骰。`; break;
    }
    default: throw new Error('未知操作');
  }
  s.players.forEach(p => { if (p.dividendsReceived === undefined) p.dividendsReceived = 0; integer(p.dividendsReceived, 0); });
  assertFinancialSafety(s); return s;
}

/** NPCs use public current state only. The planner never advances or reads future RNG. */
export function getNpcAction(s: GameState): GameAction | null {
  if (s.phase === 'finished') return null;
  const p = active(s); const tile = s.tiles[p.position];
  if (s.phase === 'moving') return { type: 'step' };
  if (p.bankrupt) return { type: 'finishTurn' };
  const readyGoal = CITY_GOALS.find(g => !p.completedGoals.includes(g.id) && goalProgress(s,p,g.id).value >= goalProgress(s,p,g.id).target);
  if (readyGoal) return { type: 'claimGoal', goalId: readyGoal.id };
  if (p.jailTurns === 0 && !s.performedActions.includes('attack')) {
    const rivals = s.players.filter(other => other.id !== p.id && !other.bankrupt).sort((a,b) => getNetWorth(s,b)-getNetWorth(s,a));
    for (const card of p.cards) {
      if (card === 'wanted') { const target = rivals.find(other => !other.jailTurns && (other.wantedImmuneUntilRound ?? 0) <= s.round); if (target) return { type:'useCard', card, targetId:target.id }; }
      if (card === 'steal') { const target = rivals.find(other => other.cash >= 100); if (target) return { type:'useCard', card, targetId:target.id }; }
      if (card === 'shutdown') { const target = s.tiles.filter(t => t.ownerId && t.ownerId !== p.id && (t.closedUntilTurn ?? 0) <= s.turn).sort((a,b) => getRent(b,s)-getRent(a,s))[0]; if (target) return { type:'useCard', card, tileId:target.id }; }
      if (card === 'swap' && s.phase === 'roll') { const target = rivals.find(other => !other.jailTurns && other.position !== p.position); if (target) return { type:'useCard', card, targetId:target.id }; }
      if (card === 'roadblock' || card === 'trap') { const target = s.tiles.find(t => t.id !== p.position && !(s.hazards ?? []).some(h => h.tileId === t.id) && (card !== 'trap' || t.type === 'property' && !t.ownerId) && (card !== 'roadblock' || (t.id - p.position + 48) % 48 <= 12) && rivals.some(other => (t.id - other.position + 48) % 48 >= 1 && (t.id - other.position + 48) % 48 <= 6)); if (target) return { type:'useCard', card, tileId:target.id }; }
    }
  }
  if (s.phase === 'roll') {
    if (p.jailTurns > 0 && p.cards.includes('jailFree')) return { type: 'useCard', card: 'jailFree' };
    if (p.jailTurns > 0 && p.cash > 1000) return { type: 'bail' };
    if (p.jailTurns === 0) { const best = VEHICLES.filter(v => p.vehicles.includes(v.id)).sort((a, b) => b.diceCount - a.diceCount)[0]; if (best && getDiceCount(p) < best.diceCount) return { type: 'equipVehicle', vehicleId: best.id }; }
    return { type: 'roll' };
  }
  if (p.jailTurns === 0 && p.cards.includes('renovation') && !s.performedActions.includes('upgrade')) { const own = s.tiles.filter(t => t.ownerId === p.id && t.level < 3).sort((a,b) => b.level-a.level || b.upgradeCost-a.upgradeCost)[0]; if (own) return { type:'useCard', card:'renovation', tileId:own.id }; }
  const reserve = p.personality === 'cautious' ? 1400 : p.personality === 'bold' ? 400 : 800;
  if (tile.type === 'property') { if (!tile.ownerId && p.cash >= tile.price + reserve) return { type: 'buy' }; if (tile.ownerId === p.id && tile.level < 3 && !s.performedActions.includes('upgrade') && p.cash >= tile.upgradeCost + reserve) return { type: 'upgrade' }; }
  if (tile.type === 'bank') {
    if (p.cash < 1800 && p.deposit > 0) return { type: 'withdraw', amount: Math.min(2000 - p.cash, p.deposit) };
    if (p.cash > 3000) return { type: 'deposit', amount: p.cash - 2400 };
    if (p.deposit > reserve + 200) { const stock = s.stocks[(s.currentPlayer + s.round) % s.stocks.length]; const quantity = Math.floor((p.deposit - reserve) / stock.price); if (quantity > 0) return { type: 'buyStock', stockId: stock.id, quantity }; }
    if (p.cash < 800 && p.deposit < 200) { const stock = s.stocks.find(st => p.holdings[st.id] > 0); if (stock) return { type: 'sellStock', stockId: stock.id, quantity: p.holdings[stock.id] }; }
  }
  if (tile.type === 'shop' && !s.performedActions.includes('buyVehicle')) {
    const ownedDice = Math.max(1, ...VEHICLES.filter(v => p.vehicles.includes(v.id)).map(v => v.diceCount));
    const desired = VEHICLES.filter(v => v.diceCount > ownedDice && p.cash >= v.price + reserve + 500);
    const vehicle = p.personality === 'bold' ? desired.at(-1) : desired[0]; if (vehicle) return { type: 'buyVehicle', vehicleId: vehicle.id };
  }
  if (tile.type === 'shop' && !s.performedActions.includes('shop') && p.cash > 1500 && p.cards.length < 3) return { type: 'shop', card: s.tiles.some(t => t.ownerId === p.id && t.level < 3) && !p.cards.includes('renovation') ? 'renovation' : (['bodyguard', 'steal', 'wanted', 'roadblock', 'trap', 'shutdown', 'swap'] as Card[])[(s.round + s.currentPlayer) % 7] };
  if (tile.type === 'construction' && !s.performedActions.includes('upgrade')) { const own = s.tiles.find(t => t.ownerId === p.id && t.level < 3 && p.cash > t.upgradeCost + 1000); if (own) return { type: 'upgrade', tileId: own.id }; }
  if (tile.type === 'auction' && !s.performedActions.includes('auction') && s.auctionTileId !== null) { const bid = Math.floor(s.tiles[s.auctionTileId].price * .8); if (p.cash > bid + 600) return { type: 'auction', bid }; }
  return { type: 'finishTurn' };
}

export function serializeGame(state: GameState): string { return JSON.stringify(state); }
/** Strict structural validation treats browser storage/imports as untrusted. */
export function deserializeGame(serialized: string): GameState {
  assert(typeof serialized === 'string' && serialized.length <= 1_000_000, '存檔過大或格式錯誤');
  let raw: Record<string, unknown>; try { raw = JSON.parse(serialized); } catch { throw new Error('無法讀取存檔'); }
  assert(raw && typeof raw === 'object', '不支援此存檔版本');
  if (raw.version === 1) {
    assert(Array.isArray(raw.players) && (raw.die === null || Number.isInteger(raw.die) && (raw.die as number) >= 0 && (raw.die as number) <= 6), '舊版存檔格式錯誤');
    raw.players = raw.players.map(p => { assert(p && typeof p === 'object', '玩家資料無效'); return { ...p, vehicles: [], vehicleId: null }; });
    raw.dice = typeof raw.die === 'number' && raw.die > 0 ? [raw.die] : []; raw.version = 2;
  }
  const s = raw as unknown as GameState;
  assert(s.version === 2 && typeof s.seed === 'string' && s.seed.length < 1000, '不支援此存檔版本');
  assert(Array.isArray(s.players) && s.players.length >= 2 && s.players.length <= 4, '玩家資料無效');
  assert(['roll', 'moving', 'action', 'finished'].includes(s.phase), '遊戲階段無效'); integer(s.currentPlayer, 0); assert(s.currentPlayer < s.players.length, '回合玩家無效');
  for (const n of [s.rngState, s.turn, s.round, s.maxRounds, s.nextLogId]) integer(n); assert(s.rngState <= 4294967295 && s.maxRounds <= 100 && s.round <= s.maxRounds && s.turn <= 400, '回合資料無效');
  integer(s.marketTick, 0); assert(s.marketTick <= 7200, '市場時間無效'); integer(s.pendingSteps, 0); assert(s.pendingSteps <= 18 && (s.phase === 'moving' ? s.pendingSteps > 0 && s.pendingSteps <= (s.die ?? 0) : s.pendingSteps === 0), '移動資料無效');
  assert(s.die === null || Number.isInteger(s.die) && s.die >= 0 && s.die <= 18, '骰子資料無效');
  assert(Array.isArray(s.dice) && s.dice.length <= 3 && s.dice.every(face => Number.isInteger(face) && face >= 1 && face <= 6) && (s.dice.length > 0 ? s.dice.reduce((sum, face) => sum + face, 0) === s.die : s.die === null || s.die === 0), '個別骰子資料無效');
  assert(s.nextDice === null || Number.isInteger(s.nextDice) && s.nextDice >= 1 && s.nextDice <= 6, '指定骰資料無效');
  assert(Array.isArray(s.stocks) && s.stocks.length === 6, '股票資料無效');
  s.stocks.forEach((st, i) => { assert(st.id === `stock-${i}` && st.name === STOCK_NAMES[i], '股票代號無效'); integer(st.price); integer(st.previousPrice); assert(st.price >= 5 && st.price <= 100000 && st.previousPrice <= 100000, '股價無效'); assert(st.volatility === [20, 16, 18, 24, 38, 30][i], '波動率無效'); assert(Array.isArray(st.history) && st.history.length >= 1 && st.history.length <= 48 && st.history.every(v => Number.isSafeInteger(v) && v >= 5 && v <= 100000) && st.history.at(-1) === st.price, '股價歷史無效'); });
  s.players.forEach((p, i) => { integer(p.mobileBankUses ?? 0,0); assert((p.mobileBankUses ?? 0) <= 3,'行動銀行次數無效'); assert(p.id === `player-${i}` && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 24 && THEMES.includes(p.theme) && p.color === COLORS[i], '玩家身分無效'); assert(typeof p.isNpc === 'boolean' && typeof p.bankrupt === 'boolean' && ['cautious', 'balanced', 'bold'].includes(p.personality), '玩家狀態無效'); integer(p.position, 0); assert(p.position < 48, '玩家位置無效'); integer(p.cash, 0); integer(p.deposit, 0); integer(p.jailTurns, 0); assert(p.jailTurns <= 2 && (p.jailTurns === 0 || p.position === 12), '監獄資料無效'); assert(p.holdings && typeof p.holdings === 'object' && Object.keys(p.holdings).length === 6 && p.costBasis && typeof p.costBasis === 'object' && Object.keys(p.costBasis).length === 6 && Number.isSafeInteger(p.realizedProfit), '持股資料無效'); s.stocks.forEach(st => { integer(p.holdings[st.id], 0); integer(p.costBasis[st.id], 0); assert(p.holdings[st.id] > 0 || p.costBasis[st.id] === 0, '持股成本無效'); }); assert(Array.isArray(p.cards) && p.cards.length <= 8 && p.cards.every(c => Object.hasOwn(CARD_NAMES, c)), '道具資料無效'); });
  s.players.forEach(p => { if (p.completedGoals === undefined) p.completedGoals = []; assert(Array.isArray(p.completedGoals) && p.completedGoals.length <= CITY_GOALS.length && new Set(p.completedGoals).size === p.completedGoals.length && p.completedGoals.every(id => CITY_GOALS.some(g => g.id === id)), '目標紀錄無效'); });
  s.players.forEach(p => { assert(Array.isArray(p.vehicles) && p.vehicles.length <= VEHICLES.length && new Set(p.vehicles).size === p.vehicles.length && p.vehicles.every(id => VEHICLES.some(v => v.id === id)), '車庫資料無效'); assert(p.vehicleId === null || p.vehicles.includes(p.vehicleId), '交通工具資料無效'); });
  assert(s.phase !== 'moving' || s.dice.length === getDiceCount(active(s)), '骰子數量與交通工具不符');
  s.players.forEach(p => {
    assert(p.wantedSkip === undefined || typeof p.wantedSkip === 'boolean', '通緝資料無效');
    assert(!p.wantedSkip || p.jailTurns === 1 && p.position === 12 && !p.bankrupt, '通緝刑期無效');
    if (p.wantedImmuneUntilRound !== undefined) { integer(p.wantedImmuneUntilRound, 0); assert(p.wantedImmuneUntilRound <= s.round + 2, '通緝保護無效'); }
  });
  if(s.propertyReport !== undefined) {
    integer(s.propertyReport.round); assert(s.propertyReport.round<=s.round && Array.isArray(s.propertyReport.changes) && s.propertyReport.changes.length===DISTRICT_NAMES.length,'房市報告無效');
    s.propertyReport.changes.forEach((c,i)=>assert(c.district===i && Number.isInteger(c.percent) && c.percent>=-5 && c.percent<=6 && c.percent!==0,'房市變動無效'));
  }
  assert(s.hazards === undefined || Array.isArray(s.hazards) && s.hazards.length <= 48, '道路道具無效');
  const hazardTiles = new Set<number>();
  for (const h of s.hazards ?? []) {
    assert(h && typeof h === 'object', '道路道具無效'); integer(h.tileId, 0); integer(h.expiresTurn);
    assert(h.tileId < 48 && !hazardTiles.has(h.tileId) && ['roadblock','trap'].includes(h.kind) && h.expiresTurn > s.turn && h.expiresTurn <= s.turn + s.players.length && s.players.some(p => p.id === h.ownerId && !p.bankrupt), '道路道具內容無效');
    hazardTiles.add(h.tileId);
  }
  const board = createGame({ seats: 2, seed: 'validation' }).tiles;
  assert(Array.isArray(s.tiles) && s.tiles.length === 48, '地圖資料無效');
  s.tiles.forEach((t, i) => { if (t.closedById !== undefined) assert(t.closedUntilTurn !== undefined && s.players.some(p => p.id === t.closedById && !p.bankrupt), '停業施放者無效'); if (t.closedUntilTurn !== undefined) { integer(t.closedUntilTurn); assert(t.type === 'property' && t.closedUntilTurn > s.turn && t.closedUntilTurn <= s.turn + s.players.length, '停業期限無效'); } const original = board[i]; assert(t.id === i && t.type === original.type && t.name === original.name && t.district === original.district && Number.isSafeInteger(t.price) && t.price >= Math.round(original.price*.5) && t.price <= original.price*3 && t.upgradeCost === original.upgradeCost, '地圖內容已損壞'); integer(t.level, 0); assert(t.level <= 3 && (t.ownerId === null || t.type === 'property' && s.players.some(p => p.id === t.ownerId && !p.bankrupt)) && (t.ownerId !== null || t.level === 0), '地產資料無效'); });
  assert(Array.isArray(s.log) && s.log.length <= 250 && s.log.every(l => l && Number.isSafeInteger(l.id) && l.id > 0 && Number.isInteger(l.round) && l.round >= 1 && l.round <= s.maxRounds && typeof l.text === 'string' && l.text.length < 1000), '遊戲紀錄無效');
  assert(Array.isArray(s.performedActions) && s.performedActions.every(a => ['upgrade', 'station', 'shop', 'buyVehicle', 'amusement', 'auction', 'attack'].includes(a)) && new Set(s.performedActions).size === s.performedActions.length, '設施紀錄無效');
  assert(typeof s.arrivalMessage === 'string' && s.arrivalMessage.length < 1000, '訊息資料無效'); assert(s.auctionTileId === null || Number.isInteger(s.auctionTileId) && s.tiles[s.auctionTileId]?.type === 'property' && !s.tiles[s.auctionTileId].ownerId, '拍賣資料無效');
  assert(Number.isInteger(s.marketTrend) && [-10, 0, 10].includes(s.marketTrend) && Number.isInteger(s.trendSteps) && s.trendSteps >= 0 && s.trendSteps <= 12, '市場趨勢無效');
  assert(s.phase === 'finished' ? s.winner === getRankings(s)[0].id : s.winner === null, '結算資料無效');
  s.players.forEach(p => { if (p.dividendsReceived === undefined) p.dividendsReceived = 0; integer(p.dividendsReceived, 0); });
  assertFinancialSafety(s); return s;
}
