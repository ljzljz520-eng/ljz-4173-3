import { describe, it, expect } from 'vitest'
import { findWhisperCandidates } from '../src/shared/analysis'
import { concat, silence, tone } from './helpers'

describe('耳语间隔候选', () => {
  it('在正常发声之间的低能量可闻段产生候选，且不把纯静音当耳语', () => {
    const sr = 16000
    const loud1 = tone(sr, 200, 1, 0.9)
    const soft = tone(sr, 180, 0.8, 0.05) // 可闻但很低
    const quiet = silence(sr, 0.8)
    const loud2 = tone(sr, 240, 1, 0.9)
    const sig = concat(loud1, quiet, soft, silence(sr, 0.3), loud2)
    const cands = findWhisperCandidates(sig, { sampleRate: sr })
    // 软声段约位于 1.8s~2.6s
    const hit = cands.find((c) => c.startSec < 2.4 && c.endSec > 2.0)
    expect(hit).toBeTruthy()
    // 纯静音段（1.0~1.8）不应被标成耳语
    expect(cands.some((c) => c.startSec >= 1.0 && c.endSec <= 1.8)).toBe(false)
    for (const c of cands) {
      expect(c.score).toBeGreaterThan(0)
      expect(c.endSec).toBeGreaterThan(c.startSec)
    }
  })

  it('全程静默时返回空', () => {
    const sig = silence(16000, 3)
    expect(findWhisperCandidates(sig, { sampleRate: 16000 })).toHaveLength(0)
  })

  it('过短的弱声不计入（受 minDurationSec 约束）', () => {
    const sr = 16000
    const sig = concat(tone(sr, 200, 1, 0.9), tone(sr, 200, 0.1, 0.04), tone(sr, 200, 1, 0.9))
    const cands = findWhisperCandidates(sig, { sampleRate: sr, minDurationSec: 0.35 })
    expect(cands.every((c) => c.endSec - c.startSec >= 0.35)).toBe(true)
  })
})
