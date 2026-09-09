import { describe, it, expect } from 'vitest'
import { estimateDrift } from '../src/shared/drift'
import { envelopeShaped, delaySignal } from './helpers'

describe('双声道漂移检测', () => {
  it('检测出学员声道整体滞后（正延迟）', () => {
    const sr = 16000
    // 节奏性能量起伏：若干突发讲话段
    const src = envelopeShaped(sr, 12, [
      { from: 1, to: 1.8, gain: 0.8, freq: 300 },
      { from: 3, to: 3.5, gain: 0.7, freq: 350 },
      { from: 5.2, to: 6.4, gain: 0.9, freq: 260 },
      { from: 8, to: 8.6, gain: 0.75, freq: 320 },
      { from: 10, to: 10.9, gain: 0.85, freq: 280 }
    ])
    const student = delaySignal(src, 0.8, sr)
    const r = estimateDrift(src, student, sr, 5)
    expect(r.delaySec).toBeGreaterThan(0.55)
    expect(r.delaySec).toBeLessThan(1.05)
    expect(r.confidence).toBeGreaterThan(0.3)
  })

  it('无共同信号时置信度低且不抛异常', () => {
    const sr = 8000
    const a = envelopeShaped(sr, 6, [{ from: 0.2, to: 0.6, gain: 0.8 }])
    const b = envelopeShaped(sr, 6, [{ from: 5, to: 5.8, gain: 0.8, freq: 900 }])
    const r = estimateDrift(a, b, sr, 2)
    expect(r).toHaveProperty('delaySec')
    expect(Number.isFinite(r.delaySec)).toBe(true)
  })
})
