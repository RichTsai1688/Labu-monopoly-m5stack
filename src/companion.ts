/** Offline companion data only. No account, external messages, or AI service is connected. */
export type ChatChannel = 'table' | 'private' | 'system';

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  author: string;
  text: string;
  at: number;
  source?: 'ai' | 'offline';
}

export interface Reminder {
  id: string;
  title: string;
  body: string;
  status: 'working' | 'done' | 'action';
  visibility: 'private';
  source: '離線示範';
  updatedAt: number;
}

export interface LabuContext {
  playerName: string;
  round: number;
  bankCount?: number;
}

export const MAX_CHAT_LENGTH = 280;

/**
 * Return bounded, readable plain text, not HTML. The renderer MUST use textContent
 * or HTML escaping; stripping tags here is not an XSS defence.
 */
export function sanitizeChatText(value: string): string {
  const plainText = value
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
  // Array.from preserves surrogate pairs (for example emoji).
  return Array.from(plainText).slice(0, MAX_CHAT_LENGTH).join('');
}

export function createWelcomeMessages(): ChatMessage[] {
  return [
    {
      id: 'welcome-table',
      channel: 'table',
      author: 'Labu',
      text: '歡迎來到玩具城市！我是 Labu，可以陪你聊銀行、股票、監獄與房屋規則。我會依遊戲狀況，用預設台詞陪大家聊天與提醒。',
      at: 0,
    },
    {
      id: 'welcome-system',
      channel: 'system',
      author: '遊戲系統',
      text: '離線試玩：48 格環線、6 處銀行。每位玩家每走 1 格，全市場股價更新 1 次；所有金額以萬元顯示。',
      at: 0,
    },
    {
      id: 'welcome-private',
      channel: 'private',
      author: 'Labu',
      text: '這是「我的 Labu」私人空間。提醒全為離線範例，尚未讀取你的真實訊息或待辦；私人內容不會出現在同桌聊天。',
      at: 0,
    },
  ];
}

/** Only exact channel matches are visible. Private messages never join table or system history. */
export function visibleMessages(messages: readonly ChatMessage[], channel: ChatChannel): ChatMessage[] {
  return messages.filter(message => message.channel === channel);
}

/** Shared notices must be a different, explicitly authorized type in a future integration. */
export function visibleReminders(reminders: readonly Reminder[], channel: ChatChannel): Reminder[] {
  if (channel !== 'private') return [];
  return reminders.filter(reminder => reminder.visibility === 'private');
}

export function getDemoReminders(): Reminder[] {
  return [
    {
      id: 'demo-working',
      title: '示範：活動資料整理中',
      body: 'Labu 正在整理活動摘要。這是模擬工作進度，沒有連到任何真實任務。',
      status: 'working',
      visibility: 'private',
      source: '離線示範',
      updatedAt: 0,
    },
    {
      id: 'demo-done',
      title: '示範：會議摘要已完成',
      body: '摘要已準備好的通知會出現在這裡。正式串接後可附上有權限存取的來源連結。',
      status: 'done',
      visibility: 'private',
      source: '離線示範',
      updatedAt: 0,
    },
    {
      id: 'demo-action',
      title: '示範：有 2 則訊息待查看',
      body: '真實提醒將只在授權後顯示。你可以稍後提醒或本局靜音，不會把內容公開給同桌玩家。',
      status: 'action',
      visibility: 'private',
      source: '離線示範',
      updatedAt: 0,
    },
  ];
}

/** Useful deterministic NPC lines. Never claims to inspect messages or take real-world actions. */
export function replyAsLabu(text: string, context?: LabuContext): string {
  const input = sanitizeChatText(text).toLocaleLowerCase();
  const name = sanitizeChatText(context?.playerName ?? '玩家').slice(0, 30) || '玩家';
  const round = Math.max(1, Math.floor(Number.isFinite(context?.round) ? context!.round : 1));
  const banks = Math.max(1, Math.floor(Number.isFinite(context?.bankCount) ? context!.bankCount! : 6));

  if (!input) return '想問什麼都可以先輸入文字。我能說明銀行、股票、監獄和蓋房規則！';
  if (/訊息|通知|提醒|待辦|任務|進度|工作|郵件|email|mail|message|remind|private|隱私|私人/.test(input)) {
    return '目前是離線示範，我沒有讀取你的真實訊息或工作。未來只會在「我的 Labu」提醒已授權的內容；共同事項必須另外允許，才會出現在同桌聊天。';
  }
  if (/交通工具|載具|步行|走路|腳踏車|單車|自行車|機車|摩托|汽車|轎車|電動車|特斯拉|tesla|model\s*[3y]|bicycle|scooter|vehicle|car\b/.test(input)) {
    return '步行每次擲 1 顆骰子，腳踏車與機車擲 2 顆，汽車擲 3 顆；汽車包含 Tesla Model 3 與 Model Y。移動距離是所有骰子的總和，每走過 1 格股票都更新 1 次，車子不會跳過沿途的市場更新。';
  }
  if (/股票|股價|市場|投資|買進|賣出|買出|stock|market/.test(input)) {
    return '每位玩家每走過 1 格，6 支股票就一起更新 1 次；走 5 格會更新 5 次。隨時都能交易，買賣使用銀行存款，若報價更新，請確認最新價格後再送出。我也不知道下一步會漲還是跌。';
  }
  if (/銀行|存款|提款|存入|領出|領錢|存錢|bank/.test(input)) {
    return `全圖有 ${banks} 處銀行，停在銀行存提款不限次數，另外提款卡有3次遠端存提款，停到銀行會自動補滿。股票不限地點、回合。必要費用先用現金與存款支付；若仍不足，會例外自動清算股票、交通工具與地產，避免負數資產。股票隨時都能買進賣出。`;
  }
  if (/監獄|坐牢|入獄|出獄|警察|保釋|jail|prison/.test(input)) {
    return '普通走到監獄只是探訪；被送入監獄才會受罰，最多停留自己的 2 個回合。可以付保釋金或用出獄卡提前離開，期間仍能聊天、查看資產與收租。';
  }
  if (/蓋房|房屋|房子|建築|建設|升級|地產|買地|租金|house|build|rent/.test(input)) {
    return '每位玩家可選糖果童話、太空科技、森林自然或海港積木建築。房屋會隨升級變成自己的地標，同地段同等級的收益一致；旗幟和地基色框可以辨認屋主。';
  }
  if (/設施|地圖|車站|公園|商店|拍賣|稅|遊樂園|機會|命運|map|station/.test(input)) {
    return '48 格城市包含地產、6 處銀行、監獄、警察局、車站、道具商店、機會廣場、公園、稅務局、遊樂園、拍賣中心和建設中心。車站傳送與送入監獄不算逐格走路，不會更新沿途股價。';
  }
  if (/金額|萬元|多少錢|單位|現金|money/.test(input)) {
    return '這座城市的金額全部以萬元顯示，例如 400 萬元、股票 2.5 萬元／股。存提款輸入框的單位也是萬元，確認前可以看到交易後餘額。';
  }
  if (/怎麼玩|規則|說明|幫助|help|rules|docs/.test(input)) {
    return '輪到你時擲骰、移動並處理落地事件。步行擲 1 顆、腳踏車與機車 2 顆、汽車 3 顆骰子，每走一格更新股價。買地收租、升級房屋、隨時投資股票，最後比較總資產。你可以問我銀行、股票、監獄、設施或房屋。';
  }
  if (/誰贏|勝負|結算|回合|輪|round|win/.test(input)) {
    return `目前來到第 ${round} 輪。限回合模式會在最後比較現金、存款、持股市值與地產價值；結算時不用特地到銀行賣股。`;
  }
  if (/你好|嗨|哈囉|哈啰|hello|hi\b|labu|拉布/.test(input)) {
    return `${name}，嗨！我是離線陪玩 Labu。一起看看這座城市吧，路過別人的飯店前記得確認手上的現金。`;
  }

  const lines = [
    `${name}，我在這裡陪你玩！你可以問我銀行怎麼用，或看看下一處想買的地產。`,
    '我的房子也想蓋得高高的，但還是得留點現金付租金。你想走地產路線還是分散投資呢？',
    '這座玩具城市連監獄都圓滾滾的。不過我還是比較想停在銀行！',
    `第 ${round} 輪還有機會！我的聊天是離線腳本，不會影響遊戲規則，也看不到未來的骰點和股價。`,
  ];
  let hash = 0;
  for (const character of input) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return lines[hash % lines.length];
}
