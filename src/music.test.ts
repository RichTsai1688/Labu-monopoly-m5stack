import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameMusic } from './music';

function setup() {
  const elements: FakeAudio[] = [];
  class FakeAudio {
    preload = ''; loop = false; volume = 1; src = '';
    play = vi.fn(async () => {});
    pause = vi.fn();
    removeAttribute = vi.fn();
    load = vi.fn();
    constructor() { elements.push(this); }
  }
  class FakeDocument extends EventTarget { hidden = false; }
  const document = new FakeDocument();
  const remove = vi.spyOn(document, 'removeEventListener');
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('document', document);
  const visibility = (hidden: boolean) => { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
  return { elements, document, visibility, remove };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('background music lifecycle', () => {
  it('does not create or play media before explicit enable; loops the local source after toggle', async () => {
    const mock = setup();
    const music = new GameMusic('/assets/city-theme.mp3');
    mock.visibility(true); mock.visibility(false);
    expect(mock.elements).toHaveLength(0);
    expect(music.enabled).toBe(false);
    expect(await music.toggle()).toBe(true);
    expect(mock.elements[0]).toMatchObject({ src: '/assets/city-theme.mp3', loop: true, volume: 0.16, preload: 'none' });
    expect(mock.elements[0].play).toHaveBeenCalledOnce();
    music.dispose();
  });

  it('pauses while hidden and resumes only while the user still wants music', async () => {
    const mock = setup();
    const music = new GameMusic('/assets/theme.mp3');
    await music.toggle();
    mock.visibility(true);
    expect(mock.elements[0].pause).toHaveBeenCalledOnce();
    expect(music.enabled).toBe(true);
    mock.visibility(false);
    expect(mock.elements[0].play).toHaveBeenCalledTimes(2);
    expect(await music.toggle()).toBe(false);
    mock.visibility(true); mock.visibility(false);
    expect(mock.elements[0].play).toHaveBeenCalledTimes(2);
    music.dispose();
  });

  it('disposes listeners and media source once and cannot restart afterward', async () => {
    const mock = setup();
    const music = new GameMusic('/assets/theme.mp3');
    await music.toggle();
    music.dispose(); music.dispose();
    expect(mock.remove).toHaveBeenCalledOnce();
    expect(mock.elements[0].removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
    expect(mock.elements[0].load).toHaveBeenCalledOnce();
    expect(await music.toggle()).toBe(false);
    mock.visibility(true); mock.visibility(false);
    expect(mock.elements[0].play).toHaveBeenCalledOnce();
  });

  it('handles playback denial without leaving music enabled or rejecting to UI', async () => {
    const mock = setup();
    const music = new GameMusic('/assets/theme.mp3');
    await music.toggle(); await music.toggle();
    mock.elements[0].play.mockRejectedValueOnce(new Error('NotAllowedError'));
    expect(await music.toggle()).toBe(false);
    expect(music.enabled).toBe(false);
    music.dispose();
  });

  it('ignores rejection from an older pending play after music has been re-enabled', async () => {
    const mock = setup();
    const music = new GameMusic('/assets/theme.mp3');
    await music.toggle(); await music.toggle();
    let rejectOlder!: (reason: Error) => void;
    mock.elements[0].play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOlder = reject; }));
    const pending = music.toggle();
    await music.toggle();
    await music.toggle();
    rejectOlder(new Error('AbortError'));
    await pending;
    expect(music.enabled).toBe(true);
    music.dispose();
  });
});
