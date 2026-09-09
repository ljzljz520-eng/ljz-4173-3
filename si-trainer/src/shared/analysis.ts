// 耳语间隔（whisper gap）候选计算：
// 同传复盘里的"耳语"指学员极低声/不完整的发声。仅依据能量特征做候选定位，
// 所有自动结果默认未采纳，必须由教员确认 —— 自动结果只能辅助定位。

export interface Interval {
  startSec: number
  endSec: number
}

export interface WhisperCandidate extends Interval {
  score: number
  /** 区间平均 RMS 相对噪声底的倍数 */
  levelRatio: number
  reason: string
}

export interface EnvelopeOptions {
  sampleRate: number
  /** 分析窗长（秒） */
  windowSec?: number
  hopSec?: number
}

export function rmsEnvelope(
  mono: Float32Array,
  opts: EnvelopeOptions
): { rms: Float32Array; times: Float32Array; windowSec: number; hopSec: number } {
  const windowSec = opts.windowSec ?? 0.04
  const hopSec = opts.hopSec ?? 0.02
  const w = Math.max(1, Math.round(windowSec * opts.sampleRate))
  const h = Math.max(1, Math.round(hopSec * opts.sampleRate))
  const n = Math.max(0, Math.floor((mono.length - w) / h) + 1)
  const rms = new Float32Array(n)
  const times = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const start = i * h
    let sum = 0
    for (let j = 0; j < w; j++) {
      const v = mono[start + j]
      sum += v * v
    }
    rms[i] = Math.sqrt(sum / w)
    times[i] = start / opts.sampleRate
  }
  return { rms, times, windowSec, hopSec }
}

export function percentile(sortedAsc: Float32Array | number[], q: number): number {
  const n = sortedAsc.length
  if (!n) return 0
  const pos = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))
  return sortedAsc[pos]
}

function sortCopy(a: Float32Array): Float32Array {
  const c = Float32Array.from(a)
  c.sort()
  return c
}

export interface WhisperOptions {
  sampleRate: number
  /** 最小耳语段长度（秒） */
  minDurationSec?: number
  /** 合并间隔小于该值的相邻段 */
  mergeGapSec?: number
  /** 分数阈值（0..1） */
  scoreThreshold?: number
}

/**
 * 计算耳语间隔候选。
 * 判据：能量高于噪声底但明显低于正常发声（位于 15%~60% 分位的低能量带），
 * 同时持续超过 minDurationSec。分数反映"低而可闻"的置信度。
 */
export function findWhisperCandidates(
  mono: Float32Array,
  opts: WhisperOptions
): WhisperCandidate[] {
  const minDur = opts.minDurationSec ?? 0.35
  const mergeGap = opts.mergeGapSec ?? 0.12
  const scoreThreshold = opts.scoreThreshold ?? 0.45
  const { rms, times, hopSec } = rmsEnvelope(mono, { sampleRate: opts.sampleRate })
  if (rms.length < 4) return []

  const sorted = sortCopy(rms)
  const noiseFloor = percentile(sorted, 0.1) || 1e-6
  const normalLevel = percentile(sorted, 0.9) || 1
  const softCeiling = noiseFloor + (normalLevel - noiseFloor) * 0.45
  const audibility = noiseFloor * 2.2

  const frameFlags = new Uint8Array(rms.length)
  const frameScores = new Float32Array(rms.length)
  for (let i = 0; i < rms.length; i++) {
    const v = rms[i]
    if (v > audibility && v < softCeiling) {
      // 越靠近"可闻但低"的中部，分数越高
      const t = (v - audibility) / Math.max(1e-9, softCeiling - audibility)
      const score = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * 0.7 + 0.3 * (v / normalLevel < 0.3 ? 1 : 0.3)
      frameFlags[i] = 1
      frameScores[i] = Math.min(1, score)
    }
  }

  const raw: WhisperCandidate[] = []
  let i = 0
  while (i < frameFlags.length) {
    if (!frameFlags[i]) { i++; continue }
    let j = i
    let scoreSum = 0
    let levelSum = 0
    while (j < frameFlags.length && frameFlags[j]) {
      scoreSum += frameScores[j]
      levelSum += rms[j]
      j++
    }
    const startSec = times[i]
    const endSec = (j < times.length ? times[j] : mono.length / opts.sampleRate) + hopSec
    raw.push({
      startSec,
      endSec,
      score: scoreSum / (j - i),
      levelRatio: levelSum / (j - i) / noiseFloor,
      reason: '低能量可闻声段（疑似耳语/犹豫），能量介于噪声底与正常发声之间'
    })
    i = j
  }

  // 合并近邻
  const merged: WhisperCandidate[] = []
  for (const c of raw) {
    const last = merged[merged.length - 1]
    if (last && c.startSec - last.endSec <= mergeGap) {
      const gap = c.endSec - last.startSec
      last.endSec = c.endSec
      last.score = (last.score * (last.endSec - c.startSec === 0 ? 1 : 1) + c.score) / 2
      last.levelRatio = (last.levelRatio + c.levelRatio) / 2
      void gap
    } else {
      merged.push({ ...c })
    }
  }

  return merged
    .filter((c) => c.endSec - c.startSec >= minDur && c.score >= scoreThreshold)
    .map((c) => ({
      ...c,
      score: Math.round(c.score * 1000) / 1000
    }))
}

/** 峰值缩略数据，用于波形绘制（每像素桶取 min/max） */
export function computePeaks(mono: Float32Array, buckets: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  const size = mono.length / buckets
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * size)
    const e = Math.max(s + 1, Math.floor((b + 1) * size))
    let lo = 1
    let hi = -1
    for (let i = s; i < e && i < mono.length; i++) {
      const v = mono[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo === 1 ? 0 : lo
    max[b] = hi === -1 ? 0 : hi
  }
  return { min, max }
}
