import type { GameAction, GameState, Theme } from './game-types';
import type { ChatMessage } from './companion';

export interface RoomSession { code: string; token: string; playerId: string }
export interface RoomSnapshot {
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  version: number;
  seats: 2 | 3 | 4;
  hostId: string;
  selfId: string;
  players: { id: string; name: string; connected: boolean; host: boolean }[];
  game: GameState | null;
  messages: ChatMessage[];
  pendingReclaim: boolean;
  labu?: { remaining: number; limit: number; pending: number; configured: boolean };
}
export interface RoomClientOptions {
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onError?: (message: string) => void;
  onSession?: (session: RoomSession) => void;
  onClose?: () => void;
}
export interface CreateRoomOptions { name: string; seats: 2 | 3 | 4; maxRounds?: number; theme?: Theme }
export interface JoinRoomOptions { code: string; name: string; theme?: Theme }

/** Browser adapter. The server owns dice, NPCs, market prices, and command authorization. */
export class RoomClient {
  snapshot: RoomSnapshot | null = null;
  session: RoomSession | null = null;
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private requestNumber = 0;
  private closed = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private httpQueue: Promise<void> = Promise.resolve();
  private controllers = new Set<AbortController>();
  private pollFailures = 0;
  private snapshotFingerprint = '';
  private get httpTransport(): boolean { return !/^wss?:/i.test(this.url); }

  private acceptSnapshot(snapshot: RoomSnapshot): void {
    if (this.closed || (this.snapshot?.code === snapshot.code && snapshot.version < this.snapshot.version)) return;
    const fingerprint = JSON.stringify(snapshot);
    if (fingerprint === this.snapshotFingerprint) return;
    this.snapshotFingerprint = fingerprint;
    this.snapshot = snapshot;
    this.options.onSnapshot(snapshot);
  }

  private schedulePoll(): void {
    if (this.closed || !this.session || this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.sendHttp('poll', {}).then(() => {
        this.pollFailures = 0;
      }).catch(() => {
        this.pollFailures += 1;
        if (this.pollFailures === 3) {
          this.snapshotFingerprint = ''; // Recovery must restore the UI even when game state has not changed.
          this.options.onClose?.();
          this.options.onError?.('房間連線暫時不穩，正在自動重試。');
        }
      }).finally(() => this.schedulePoll());
    }, Math.min(8000, 450 * 2 ** Math.min(this.pollFailures, 5)));
  }

  private sendHttp(type: string, data: object): Promise<void> {
    // Serialize requests so a delayed poll cannot overwrite a newer command response.
    const operation = this.httpQueue.then(async () => {
      if (this.closed) throw new Error('連線已關閉');
      // An uncertain create/join may already have committed: reuse its exact identity on retry.
      const body = JSON.stringify({ type, requestId: crypto.randomUUID(), ...this.session, ...data });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (this.closed) throw new Error('連線已關閉');
        const controller = new AbortController();
        this.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 8000);
        let retryable = true;
        try {
          const response = await fetch(this.url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            signal: controller.signal,
          });
          retryable = response.status === 409 || response.status >= 500;
          const message = await response.json() as { session?: RoomSession; snapshot?: RoomSnapshot; error?: unknown };
          if (this.closed) return;
          if (!response.ok || message.error) throw new Error(typeof message.error === 'string' ? message.error : '房間操作失敗');
          if (message.session) {
            this.session = message.session;
            this.options.onSession?.(message.session);
          }
          if (message.snapshot) this.acceptSnapshot(message.snapshot);
          if (type !== 'poll') this.schedulePoll();
          return;
        } catch (error) {
          if (this.closed || type === 'poll' || attempt > 0 || !retryable) throw error;
        } finally {
          clearTimeout(timeout);
          this.controllers.delete(controller);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    });
    this.httpQueue = operation.catch(() => {});
    return operation;
  }

  constructor(private readonly url = 'ws://127.0.0.1:5174', private readonly options: RoomClientOptions) {}

  create(options: CreateRoomOptions): Promise<void> { return this.send('create', options); }
  join(options: JoinRoomOptions): Promise<void> { return this.send('join', options); }
  reconnect(session: Pick<RoomSession, 'code' | 'token'>): Promise<void> { return this.send('reconnect', session); }
  start(): Promise<void> { return this.send('start', {}); }
  command(action: GameAction): Promise<void> {
    if (!this.snapshot) return Promise.reject(new Error('尚未加入房間'));
    return this.send('command', { action, expectedVersion: this.snapshot.version });
  }
  chat(text: string, askLabu = false): Promise<void> { return this.send('chat', { text, askLabu }); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    for (const controller of this.controllers) controller.abort();
    if (this.httpTransport && this.session) {
      void fetch(this.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'leave', requestId: crypto.randomUUID(), ...this.session }),
        keepalive: true,
      }).catch(() => {});
    }
    this.socket?.close(1000, 'Client closed');
    this.rejectPending('連線已關閉');
  }

  private connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('連線已關閉，請建立新的 RoomClient'));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timeout = setTimeout(() => { socket.close(); reject(new Error('連線逾時，請確認本機房間服務已啟動')); }, 8000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('無法連線至房間服務')); }, { once: true });
      socket.addEventListener('message', event => this.receive(event.data));
      socket.addEventListener('close', () => {
        clearTimeout(timeout);
        this.connecting = null;
        this.rejectPending('與房間的連線已中斷，可以使用重新連線按鈕');
        this.options.onClose?.();
        reject(new Error('連線已關閉'));
      });
    });
    return this.connecting;
  }

  private async send(type: string, data: object): Promise<void> {
    if (this.httpTransport) return this.sendHttp(type, data);
    await this.connect();
    const requestId = `${Date.now().toString(36)}-${++this.requestNumber}-${crypto.randomUUID()}`;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error('房間操作逾時，請重新連線確認狀態')); }, 8000);
      this.pending.set(requestId, { resolve, reject, timeout });
      try { this.socket!.send(JSON.stringify({ type, requestId, ...data })); }
      catch { clearTimeout(timeout); this.pending.delete(requestId); reject(new Error('無法傳送操作')); }
    });
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string' || data.length > 1_000_000) return;
    let message: Record<string, any>;
    try { message = JSON.parse(data); } catch { return; }
    if (message.type === 'snapshot' && message.snapshot) {
      this.acceptSnapshot(message.snapshot as RoomSnapshot);
    } else if (message.type === 'session') {
      this.session = message.session as RoomSession;
      this.options.onSession?.(this.session);
    } else if (message.type === 'ack' || message.type === 'error') {
      const pending = this.pending.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.requestId);
        if (message.type === 'ack') pending.resolve();
        else pending.reject(new Error(message.message || '房間操作失敗'));
      }
      if (message.type === 'error') this.options.onError?.(message.message || '房間操作失敗');
    }
  }

  private rejectPending(reason: string): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(reason)); }
    this.pending.clear();
  }
}
