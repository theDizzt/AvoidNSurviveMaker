import type { GraphicsLevel, Options } from './options';
import { gpuName } from './resource-monitor';

/**
 * Device check: reads what the browser tells about this device and picks Graphics options to
 * match. Everything stays in this browser; nothing is sent anywhere. The player is asked once
 * (see device-consent.ts) before it runs.
 */
export interface DeviceInfo {
  /** Logical CPU cores, 0 when unknown */
  cores: number;
  /** Approximate RAM in GB (Chromium only), 0 when unknown */
  memoryGb: number;
  /** GPU name as WebGL reports it, null when hidden */
  gpu: string | null;
  /** Screen size in device pixels */
  screenPixels: number;
  /** Touch-first device (phone, tablet) */
  mobile: boolean;
  /** The player asked the system for less motion */
  reducedMotion: boolean;
}

/** Read this device's details from the browser */
export function readDevice(): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const dpr = window.devicePixelRatio || 1;
  const media = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  return {
    cores: nav.hardwareConcurrency || 0,
    memoryGb: nav.deviceMemory || 0,
    gpu: gpuName(),
    screenPixels: Math.round(screen.width * dpr) * Math.round(screen.height * dpr),
    mobile: media('(pointer: coarse)') && !media('(any-pointer: fine)'),
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
  };
}

export type GpuClass = 'software' | 'weak' | 'integrated' | 'discrete' | 'unknown';

/** Rough GPU class from its name */
export function gpuClass(gpu: string | null): GpuClass {
  if (!gpu) return 'unknown';
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) return 'software';
  if (/mali-[gt]?[0-9]{1,2}\b|adreno.{0,12}\b[1-5][0-9]{2}\b|powervr|intel.{0,20}(?<!u)hd graphics [0-9]{3}\b|\bgma\b/.test(g)) return 'weak';
  if (/geforce|quadro|rtx|gtx|radeon (rx|pro)|radeon\(tm\) rx|arc a[0-9]|apple m[0-9] (pro|max|ultra)/.test(g)) return 'discrete';
  if (/intel|uhd|iris|radeon|vega|apple|adreno|mali/.test(g)) return 'integrated';
  return 'unknown';
}

/** Graphics options that suit this device */
export function recommendOptions(d: DeviceInfo): Partial<Options> {
  const gpu = gpuClass(d.gpu);
  const lowCpu = (d.cores > 0 && d.cores <= 2) || (d.memoryGb > 0 && d.memoryGb <= 2);
  const midCpu = (d.cores > 0 && d.cores <= 4) || (d.memoryGb > 0 && d.memoryGb <= 4);

  // Same as the Low Spec button
  if (gpu === 'software' || lowCpu) {
    return {
      graphics: 'low', frameLimit: 60, pollingRate: -1, lowSpecSimulation: true, autoQuality: true,
      cursorTrail: false, decorativeEffects: false, animatedBackground: false, interfaceEffects: false, transparency: false,
    };
  }

  let graphics: GraphicsLevel;
  if (gpu === 'weak' || midCpu || d.mobile) graphics = 'medium';
  // Supersampling only where it stays within the Ultra pixel cap (1080p / 1440p screens)
  else if (gpu === 'discrete' && d.cores >= 8 && d.screenPixels * 2.25 <= 3840 * 2160 * 1.05) graphics = 'ultra';
  else graphics = 'high';

  const out: Partial<Options> = { graphics, frameLimit: 0, lowSpecSimulation: false, autoQuality: true };
  if (d.reducedMotion) Object.assign(out, { animatedBackground: false, interfaceEffects: false });
  return out;
}

/**
 * GPU name without the WebGL wrapper: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782)
 * Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 4070 Ti"
 */
export function shortGpuName(gpu: string | null): string | null {
  if (!gpu) return null;
  const angle = /^ANGLE \((?:[^,]+), (.+?)(?:, [^,]+)?\)$/.exec(gpu);
  const name = (angle ? angle[1] : gpu)
    .replace(/^ANGLE \w+ Renderer:\s*/i, '')
    .replace(/\s*\(0x[0-9a-f]+\)/i, '')
    .replace(/\s+(Direct3D|OpenGL|Vulkan)\S*.*$/i, '')
    .trim();
  return name || gpu;
}
