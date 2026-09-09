import { encodeWav } from '../src/shared/wav'

/** 生成带包络的正弦波 */
export function tone(sampleRate: number, freq: number, durSec: number, amp = 0.6, phase = 0): Float32Array {
  const n = Math.round(sampleRate * durSec)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin(2 * Math.PI * freq * (i / sampleRate) + phase) * amp
  }
  return out
}

export function silence(sampleRate: number, durSec: number): Float32Array {
  return new Float32Array(Math.round(sampleRate * durSec))
}

/** 把信号延迟 padSec（前面补零、后面截断），模拟学员声道滞后 */
export function delaySignal(sig: Float32Array, padSec: number, sampleRate: number): Float32Array {
  const pad = Math.round(padSec * sampleRate)
  const out = new Float32Array(sig.length + pad)
  out.set(sig, pad)
  return out
}

/** 调制包络：在指定秒数区间设置增益 */
export function envelopeShaped(sampleRate: number, durSec: number, regions: Array<{ from: number; to: number; gain: number; freq?: number }>): Float32Array {
  const n = Math.round(sampleRate * durSec)
  const out = new Float32Array(n)
  for (const r of regions) {
    const s = Math.round(r.from * sampleRate)
    const e = Math.round(r.to * sampleRate)
    const f = r.freq ?? 220
    for (let i = s; i < e && i < n; i++) out[i] = Math.sin(2 * Math.PI * f * i / sampleRate) * r.gain
  }
  return out
}

export function makeWav(sampleRate: number, channels: Float32Array[]): Buffer {
  return encodeWav(channels, { sampleRate, channels: channels.length, bitsPerSample: 16 })
}

export function concat(...arrs: Float32Array[]): Float32Array {
  const n = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Float32Array(n)
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}
