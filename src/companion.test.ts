import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from './audio';
import {
  createWelcomeMessages,
  getDemoReminders,
  MAX_CHAT_LENGTH,
  replyAsLabu,
  sanitizeChatText,
  visibleMessages,
  visibleReminders,
} from './companion';

describe('offline companion privacy', () => {
  it('never includes private chat or reminders in public channels', () => {
    const messages = createWelcomeMessages();
    const reminders = getDemoReminders();
    for (const channel of ['table', 'system'] as const) {
      expect(visibleMessages(messages, channel).some(message => message.channel === 'private')).toBe(false);
      expect(visibleReminders(reminders, channel)).toEqual([]);
    }
    expect(visibleMessages(messages, 'private')).toHaveLength(1);
    expect(visibleReminders(reminders, 'private')).toHaveLength(3);
  });

  it('labels all reminders as synthetic and returns fresh values', () => {
    const first = getDemoReminders();
    expect(first.every(reminder => reminder.source === '離線示範' && reminder.title.includes('示範'))).toBe(true);
    first[0].title = 'changed';
    expect(getDemoReminders()[0].title).not.toBe('changed');
    expect(new Set(first.map(reminder => reminder.status))).toEqual(new Set(['working', 'done', 'action']));
  });

  it('never pretends to read a real inbox or work task', () => {
    expect(replyAsLabu('告訴大家我的新訊息')).toContain('沒有讀取你的真實訊息');
    expect(replyAsLabu('通知與股價怎麼了')).toContain('我的 Labu');
  });
});

describe('bounded plain-text input', () => {
  it('normalizes whitespace and removes control and direction override characters', () => {
    expect(sanitizeChatText('  嗨\n\tLabu\u0000\u202E！  ')).toBe('嗨 Labu！');
    expect(sanitizeChatText(' \n\t\u0000 ')).toBe('');
  });

  it('bounds messages without cutting emoji surrogate pairs', () => {
    const result = sanitizeChatText('🎲'.repeat(500));
    expect(Array.from(result)).toHaveLength(MAX_CHAT_LENGTH);
    expect(result).toBe('🎲'.repeat(MAX_CHAT_LENGTH));
  });

  it('preserves literal markup as text for the renderer to escape', () => {
    expect(sanitizeChatText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('scripted Labu rules', () => {
  it('explains per-cell market updates and remote trading', () => {
    const reply = replyAsLabu('股票怎麼買');
    expect(reply).toContain('走過 1 格');
    expect(reply).toContain('走 5 格會更新 5 次');
    expect(reply).toContain('隨時都能交易');
    expect(reply).toContain('不知道下一步');
  });

  it('uses supplied context without randomness or external data', () => {
    expect(replyAsLabu('銀行', { playerName: '小美', round: 3, bankCount: 6 })).toContain('6 處銀行');
    expect(replyAsLabu('現在第幾輪', { playerName: '小美', round: 3 })).toContain('第 3 輪');
    expect(replyAsLabu('我有一個主意')).toBe(replyAsLabu('我有一個主意'));
    expect(replyAsLabu('目前回合', { playerName: '', round: NaN })).toContain('第 1 輪');
  });

  it('provides short useful responses for each facility and empty input', () => {
    for (const question of ['', '銀行', '股票', '監獄', '房屋', '設施', '萬元', '怎麼玩', '你好']) {
      const answer = replyAsLabu(question);
      expect(answer.length).toBeGreaterThan(15);
      expect(Array.from(answer).length).toBeLessThan(MAX_CHAT_LENGTH);
    }
  });

  it('explains vehicle dice totals and preserves per-tile stock updates', () => {
    for (const question of ['走路', '腳踏車', '機車', '汽車', 'Tesla Model 3', 'Tesla Model Y']) {
      const answer = replyAsLabu(question);
      expect(answer).toContain('步行每次擲 1 顆');
      expect(answer).toContain('腳踏車與機車擲 2 顆');
      expect(answer).toContain('汽車擲 3 顆');
      expect(answer).toContain('所有骰子的總和');
      expect(answer).toContain('每走過 1 格股票都更新 1 次');
      expect(Array.from(answer).length).toBeLessThan(MAX_CHAT_LENGTH);
    }
    // Vehicle questions must never override privacy explanations.
    expect(replyAsLabu('我收到 Tesla 的私人訊息')).toContain('沒有讀取你的真實訊息');
  });
});

describe('safe synthesized audio', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('stays silent and fails gracefully without browser audio', () => {
    const audio = new GameAudio();
    expect(audio.enabled).toBe(false);
    expect(() => audio.play('roll')).not.toThrow();
    expect(audio.toggle()).toBe(false);
    expect(audio.enabled).toBe(false);
  });

  function installAudioMock() {
    const gains: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
    const oscillators: Array<{ stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
    const contexts: MockContext[] = [];
    class MockContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = vi.fn(async () => { this.state = 'running'; });
      close = vi.fn(async () => { this.state = 'closed'; });
      constructor() { contexts.push(this); }
      createGain() {
        const gain = { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(gain);
        return gain;
      }
      createOscillator() {
        const oscillator = { type: 'sine', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
        oscillators.push(oscillator);
        return oscillator;
      }
    }
    vi.stubGlobal('window', { AudioContext: MockContext });
    return { contexts, gains, oscillators };
  }

  it('unlocks only via toggle and releases scheduled voices immediately on mute', () => {
    const mock = installAudioMock();
    const audio = new GameAudio();
    audio.play('bank');
    expect(mock.contexts).toHaveLength(0);
    expect(audio.toggle()).toBe(true);
    audio.play('bank');
    expect(mock.oscillators).toHaveLength(3);
    expect(audio.toggle()).toBe(false);
    for (const voice of mock.oscillators) {
      expect(voice.stop).toHaveBeenCalledTimes(2);
      expect(voice.disconnect).toHaveBeenCalledOnce();
      expect(voice.onended).toBeNull();
    }
    for (const envelope of mock.gains.slice(1)) expect(envelope.disconnect).toHaveBeenCalledOnce();
    audio.play('coin');
    expect(mock.oscillators).toHaveLength(3);
  });

  it('disposes every node and closes the context once, allowing later explicit unlock', async () => {
    const mock = installAudioMock();
    const audio = new GameAudio();
    audio.toggle();
    audio.play('win');
    await audio.dispose();
    await audio.dispose();
    expect(audio.enabled).toBe(false);
    expect(mock.contexts[0].close).toHaveBeenCalledOnce();
    for (const gain of mock.gains) expect(gain.disconnect).toHaveBeenCalledOnce();
    for (const voice of mock.oscillators) expect(voice.disconnect).toHaveBeenCalledOnce();
    audio.play('win');
    expect(mock.contexts).toHaveLength(1);
    audio.toggle();
    expect(mock.contexts).toHaveLength(2);
    await audio.dispose();
  });

  it('bounds simultaneous audio nodes and releases each completed voice', async () => {
    const mock = installAudioMock();
    const audio = new GameAudio();
    audio.toggle();
    for (let i = 0; i < 10; i++) audio.play('win');
    expect(mock.oscillators).toHaveLength(24);
    mock.oscillators[0].onended!();
    expect(mock.oscillators[0].disconnect).toHaveBeenCalledOnce();
    expect(mock.gains[1].disconnect).toHaveBeenCalledOnce();
    audio.play('click');
    expect(mock.oscillators).toHaveLength(25);
    await audio.dispose();
    for (const gain of mock.gains) expect(gain.disconnect).toHaveBeenCalledOnce();
  });
});
