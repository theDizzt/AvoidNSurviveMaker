import { t } from './i18n';
import { onOptionsChange, options } from './options';
import clickUrl from '../sfx/click.mp3';
import coinUrl from '../sfx/coin.mp3';
import finishUrl from '../sfx/finish.mp3';
import starUrl from '../sfx/star.mp3';

/** Sound effect files (src/sfx) */
const SFX = { click: clickUrl, coin: coinUrl, finish: finishUrl, star: starUrl } as const;
export type Sfx = keyof typeof SFX;

/** Music crossfade: the old track fades out while the new one fades in (seconds) */
const FADE_OUT = 0.9;
const FADE_IN = 1.2;

interface Track {
  source: AudioBufferSourceNode;
  /** Per-track fade gain, in front of the shared music volume */
  fade: GainNode;
}

/** Below this level (about -46 dB) a sample counts as silence */
const SILENCE = 0.005;
/** Start this much before the first sound, so its attack isn't clipped (s) */
const ATTACK = 0.005;

/** Time of the first audible sample, so effects play the moment they're triggered */
function soundStart(buffer: AudioBuffer): number {
  let first = buffer.length;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < first; i++) {
      if (Math.abs(data[i]) > SILENCE) { first = i; break; }
    }
  }
  return first >= buffer.length ? 0 : Math.max(0, first / buffer.sampleRate - ATTACK);
}

/** All sound sources pass through their category gain, then the master gain. */
class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private track: Track | null = null;
  /** Recently decoded music, so switching back and forth is instant */
  private readonly buffers = new Map<string, AudioBuffer>();
  private musicRequest: AbortController | null = null;
  private trackUrl: string | null = null;
  /** Decoded sound effects, loaded once the audio context exists */
  private readonly sfx = new Map<Sfx, AudioBuffer>();
  /** Where each effect's sound actually begins (s): files may start with silence */
  private readonly sfxStart = new Map<Sfx, number>();

  constructor() {
    onOptionsChange(() => this.sync());
    const unlock = () => {
      this.init();
      if (!document.hidden) void this.context?.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        void this.context?.suspend().catch(() => {});
      } else unlock();
    });
  }

  private init(): void {
    if (this.context) return;
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.music = this.context.createGain();
      this.effects = this.context.createGain();
      this.music.connect(this.master);
      this.effects.connect(this.master);
      this.master.connect(this.context.destination);
      this.sync();
      void this.loadSfx();
    } catch { /* Audio is optional when unsupported or unavailable. */ }
  }

  private async loadSfx(): Promise<void> {
    const ctx = this.context!;
    await Promise.all((Object.keys(SFX) as Sfx[]).map(async (name) => {
      try {
        const response = await fetch(SFX[name]);
        if (!response.ok) throw new Error(t('audio.downloadFailed', { status: response.status }));
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        this.sfx.set(name, buffer);
        this.sfxStart.set(name, soundStart(buffer));
      } catch (error) {
        console.warn(`Could not load sound effect "${name}".`, error);
      }
    }));
  }

  /** Play a sound effect (silently skipped until audio is unlocked and the file is loaded) */
  play(name: Sfx): void {
    const ctx = this.context;
    const buffer = this.sfx.get(name);
    if (!ctx || !this.effects || !buffer || ctx.state !== 'running') return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.effects);
    source.onended = () => source.disconnect();
    source.start(0, this.sfxStart.get(name) ?? 0);
  }

  private sync(): void {
    if (!this.context) return;
    for (const [gain, volume] of [[this.master, options.masterVolume], [this.music, options.musicVolume], [this.effects, options.effectsVolume]] as const) {
      if (!gain) continue;
      gain.gain.setTargetAtTime(volume / 100, this.context.currentTime, 0.015);
    }
  }

  /** Attach a music asset when one is supplied; shares the live volume controls. */
  setMusic(url: string | null): void {
    if (url === this.trackUrl) return;
    this.musicRequest?.abort();
    this.musicRequest = null;
    this.fadeOut();
    this.trackUrl = null;
    if (!url) return;
    this.init();
    if (!this.context || !this.music) return;
    this.trackUrl = url;
    const request = new AbortController();
    this.musicRequest = request;
    void this.loadMusic(url, request);
  }

  /** Fade the playing track out, then stop it */
  private fadeOut(): void {
    const track = this.track;
    this.track = null;
    if (!track || !this.context) return;
    const now = this.context.currentTime;
    const gain = track.fade.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + FADE_OUT);
    track.source.onended = () => {
      track.source.disconnect();
      track.fade.disconnect();
    };
    track.source.stop(now + FADE_OUT + 0.05);
  }

  private async loadMusic(url: string, request: AbortController): Promise<void> {
    const ctx = this.context!;
    try {
      let buffer = this.buffers.get(url);
      if (!buffer) {
        const response = await fetch(url, { signal: request.signal });
        if (!response.ok) throw new Error(t('audio.downloadFailed', { status: response.status }));
        buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        this.buffers.set(url, buffer);
        // Decoded audio is large (~40 MB for two minutes): keep only the latest two tracks
        for (const key of this.buffers.keys()) if (this.buffers.size > 2 && key !== url) this.buffers.delete(key);
      }
      // Decoding cannot be cancelled, so discard a track replaced during decoding.
      if (request.signal.aborted || this.musicRequest !== request) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      const fade = ctx.createGain();
      const now = ctx.currentTime;
      fade.gain.setValueAtTime(0, now);
      fade.gain.linearRampToValueAtTime(1, now + FADE_IN);
      source.connect(fade).connect(this.music!);
      this.track = { source, fade };
      // AudioBufferSourceNode loops on the audio clock without media-element seek gaps.
      source.start();
    } catch (error) {
      if (request.signal.aborted || this.musicRequest !== request) return;
      this.trackUrl = null;
      console.warn('Could not load background music.', error);
    }
  }

  death(): void {
    const ctx = this.context;
    if (!ctx || !this.effects || ctx.state !== 'running') return;
    const duration = 0.22;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, ctx.currentTime);
    envelope.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter).connect(envelope).connect(this.effects);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
    source.start();
    source.stop(ctx.currentTime + duration);
  }
}

export const gameAudio = new GameAudio();
