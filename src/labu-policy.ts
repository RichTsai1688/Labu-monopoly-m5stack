import { BANK_POSITIONS, BAIL_COST, CARD_NAMES, CARD_PRICES, CARD_DESCRIPTIONS, CITY_GOALS, HAND_LIMIT, START_SALARY, VEHICLES, createGame, formatMoney, getRent } from './engine';
import { DIVIDENDS, SEASONS } from './calendar';

export const LABU_MAX_OUTPUT_TOKENS = 2048;
export const LABU_TURN_QUESTION_LIMIT = 10;
export const LABU_CONTEXT_BUDGET = 256_000;
export interface LabuMemoryEntry { author: string; text: string; at: number }
export interface LabuMemory { summary: string; entries: LabuMemoryEntry[] }
export const emptyLabuMemory = (): LabuMemory => ({ summary: '', entries: [] });
/** Explicit aliases, insensitive to full-width letters, punctuation and spacing. */
export function isLabuMention(text: string): boolean {
  return /labu|拉布|老布|拉卜|拉不|拉伯|拉波|拉寶|老卜/.test(text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\u200b-\u200f\ufeff]+/gu, ''));
}
export function shouldAskLabu(text: string, explicit = false): boolean { return explicit || isLabuMention(text); }
/** Conservative UTF-8 byte upper bound, NOT an exact model tokenizer. */
export function conservativeUtf8TokenUpperBound(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}
const reference = createGame({ seed: 'labu-rulebook' });
export const LABU_RULEBOOK = `Labu 玩具城市完整遊戲規則（以目前引擎為準）
開局：2–4席，空位NPC補足。常用6/10/12/20/24輪，預設12輪；依本局設定結算。每人現金400萬元、存款200萬元。四種房屋主題糖果/太空/森林/海港只影響外觀。48格含24地產，銀行格為${BANK_POSITIONS.join('、')}（起點0）。
流程：每人一次行動為回合，全體各一次為一輪。擲骰前選交通工具/指定骰/保釋；按骰子逐格移動，每一格更新六支股票一次；停下處理設施或租金，買地建屋等，再結束回合。路過普通設施不啟動功能。正常跨起點領${formatMoney(START_SALARY)}。步行一骰，指定骰只指定第一顆1–6，其他骰子仍隨機。聊天等待動畫不影響行情或日曆。
地產：現金買地即0級，最高3級。停自己的地或建設中心可付費升級；每回合只建設一次，與遠端建設卡共用。0/1/2/3級基本租金為原地價12%/25%/48%/80%，以0.1萬元四捨五入。收齊街區租金加50%、付費建設八折；不必收齊才能建。1級小街屋，2級更多樓層陽台，3級主題塔樓，均有入口、遮雨棚、花盆等。
銀行：股票可隨時買賣，包含其他玩家回合；提款卡有3次遠端存提款，成功存款或提款各扣1次；實際停到銀行自動補滿3次，路過不補；銀行辦理不扣次數。每2輪房市按街區調價，多數上漲2–6%，偶爾下跌2–5%，售價限制為初始0.5–3倍，估值與租金同步；建造費不變。買股扣存款、賣股回存款；元/股報價，1張1000股，不放空，無手續費，無定期存款利息。新聞趨勢持續12步，不保證收益。每股30元的一張成本3萬元。每2輪換春夏秋冬，8輪一年。季末結算前持股者領年度現金股利入銀行，同時每股價格減配息。若除息會低於5元該次不配，持股/成本不變；最後輪遇季末先配再排名；重新載入不重配。季末資格、除息、入帳同步為遊戲簡化，非即時真實股票。配息表：${reference.stocks.map((s,i) => `${s.name}：${SEASONS[DIVIDENDS[i].season]}季末每股${DIVIDENDS[i].perShare}元`).join('；')}。
設施：公園+15萬元；事件可能+35萬元、付20萬元保養費、出獄卡或市場趨勢，背包滿時卡折20萬元。稅務局收總資產3.5%最低10萬元。車站付10萬元到另一站，不觸發沿途格、股價或起點。遊樂園付10萬元，獎金0/10/20/40萬元。拍賣中心無主地約原價65%起標，訪客與NPC競價，非全體真人即時競標。商店每次可買一張卡與一款交通工具，各限一次。建設中心升級任一自有未滿級地。
監獄：直接走到是探訪；警察局送監獄服刑2輪（入獄當輪計入），全體完成一輪扣一，按骰不會減刑。${formatMoney(BAIL_COST)}保釋或出獄卡立即解禁。坐牢仍收租、配息、聊天。通緝令則最多錯過一次移動，與警察局不同。
交通工具：步行免費1骰；${VEHICLES.map(v => `${v.name} ${formatMoney(v.price)} ${v.diceCount}骰`).join('；')}。買後下一個自由擲骰前車庫換乘；同骰數車只有外觀差異，可換回步行。
道具：背包上限${HAND_LIMIT}張，舊檔多出的保留至用完。${Object.entries(CARD_NAMES).map(([id,name]) => `${name} ${formatMoney(CARD_PRICES[id as keyof typeof CARD_PRICES])}：${CARD_DESCRIPTIONS[id as keyof typeof CARD_DESCRIPTIONS]}`).join('\n')}
攻擊補充：通緝/小偷/路障/陷阱/停業/換位是攻擊卡，每回合最多一張，限未服刑擲骰前或抵達後。保鑣擋下仍消耗攻擊額度與卡；無效目標不消耗。通緝目標必須自由且未受保護，約2輪免疫。小偷偷現有現金10%向下取0.1萬元，上限30萬元，不動存款/股票。路障第一位經過者停下（含自己）照常處理格子；陷阱放無主地，對手付最多15萬元現金、不清算；自己踩會拆除不轉錢。兩者放置後一圈回合失效。停業到施放者下次回合開始；換位不觸發格子和起點。攻擊已發生結果公開，未使用手牌不可憑空猜測。
城市目標：${CITY_GOALS.map(g => `${g.name}：${g.detail}，領${formatMoney(g.reward)}`).join('；')}。每人每局各一次，擲骰前/抵達後到我的資產領取，不耗骰。
勝負：到設定輪數或僅一位未破產即結算；未破產優先，再總資產，同分依席位。總資產=現金+存款+股票市值+土地原價+累計標準建設成本+車輛半價殘值。必要費用先現金再存款，不足自動清算股票/車輛/地產，仍不足破產；主動購物/建設不自動提款。
各地原價/每次標準升級費/0至3級租金（萬元）：\n${reference.tiles.filter(t=>t.type==='property').map(t=>`${t.name} ${formatMoney(t.price)} / ${formatMoney(t.upgradeCost)} / ${[0,1,2,3].map(level=>formatMoney(getRent({...t,level:level as 0|1|2|3}))).join('、')}`).join('\n')}
聊天：按問Labu或文字提及Labu、拉布、老布等都可問玩法、遇到問題或友善閒聊。每位玩家每回合主動詢問10次，無詢問冷卻；自發評論不占額度。Labu可每回合或有趣事件簡短回應。沒有真實郵件/工作待辦整合，只能見公開遊戲資料，不可編造私人提醒。連線可開房傳邀請連結入位，空位NPC；公開聊天同步。離線本機存檔存在瀏覽器，可匯出匯入；清除網站資料會刪除。設定有快轉/輕量畫質/減少動態/音樂音效，不改規則。未實作地產自由交易/抵押/全體真人即時拍賣。`;
