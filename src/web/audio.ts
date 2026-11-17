import { onOptionsChange, options } from './options';

/** Music crossfade: the old track fades out while the new one fades in (seconds) */
const FADE_OUT = 0.9;
const FADE_IN = 1.2;

interface Track {
  source: AudioBufferSourceNode;
  /** Per-track fade gain, in front of the shared music volume */
  fade: GainNode;
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
    } catch { /* Audio is optional when unsupported or unavailable. */ }
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
        if (!response.ok) throw new Error(`Music download failed: ${response.status}`);
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
