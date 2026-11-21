import { describe, expect, it } from 'vitest';
import { gpuClass, recommendOptions, shortGpuName, type DeviceInfo } from './device-profile';

const base: DeviceInfo = { cores: 8, memoryGb: 8, gpu: null, screenPixels: 1920 * 1080, mobile: false, reducedMotion: false };
const dev = (d: Partial<DeviceInfo>): DeviceInfo => ({ ...base, ...d });

describe('gpuClass', () => {
  it('sorts common GPU names', () => {
    expect(gpuClass('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)')).toBe('software');
    expect(gpuClass('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(gpuClass('ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(gpuClass('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
    expect(gpuClass('ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('weak');
    expect(gpuClass('Mali-G52')).toBe('weak');
    expect(gpuClass(null)).toBe('unknown');
  });
});

describe('recommendOptions', () => {
  it('uses the low spec preset for software rendering or a weak CPU', () => {
    expect(recommendOptions(dev({ gpu: 'SwiftShader' })).graphics).toBe('low');
    expect(recommendOptions(dev({ cores: 2 }))).toMatchObject({ graphics: 'low', frameLimit: 60 });
  });

  it('picks ultra only for a strong desktop on a 1080p / 1440p screen', () => {
    const rtx = 'NVIDIA GeForce RTX 4070';
    expect(recommendOptions(dev({ gpu: rtx })).graphics).toBe('ultra');
    expect(recommendOptions(dev({ gpu: rtx, screenPixels: 2560 * 1440 })).graphics).toBe('ultra');
    expect(recommendOptions(dev({ gpu: rtx, screenPixels: 3840 * 2160 })).graphics).toBe('high');
  });

  it('steps down for integrated graphics, small machines and phones', () => {
    expect(recommendOptions(dev({ gpu: 'Intel(R) UHD Graphics 620' })).graphics).toBe('high');
    expect(recommendOptions(dev({ gpu: 'Intel(R) UHD Graphics 620', cores: 4 })).graphics).toBe('medium');
    expect(recommendOptions(dev({ gpu: 'Adreno (TM) 740', mobile: true })).graphics).toBe('medium');
  });

  it('honors reduce motion', () => {
    expect(recommendOptions(dev({ reducedMotion: true }))).toMatchObject({ animatedBackground: false, interfaceEffects: false });
  });
});

describe('shortGpuName', () => {
  it('drops the WebGL wrapper', () => {
    expect(shortGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 4070 Ti');
    expect(shortGpuName('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel(R) UHD Graphics 620');
    expect(shortGpuName('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe('Apple M2');
    expect(shortGpuName('Mali-G52')).toBe('Mali-G52');
  });
});
