// 双声道漂移检测：
// 源讲话与学员译音分开采集时，时钟/启动时机不同会产生整体时间偏移。
// 用 RMS 能量包络的归一化互相关估计漂移，仅作辅助建议，教员可在复盘页微调。

import { rmsEnvelope } from './analysis'

export interface DriftResult {
  /** 学员声道相对源声道的滞后秒数（正值=学员在时间轴上落后，需把学员轨前移） */
  delaySec: number
  /** 相关系数峰值 [-1,1]，越高越可信 */
  confidence: number
  searchedRangeSec: number
}

export function estimateDrift(
  sourceMono: Float32Array,
  studentMono: Float32Array,
  sampleRate: number,
  maxDriftSec = 5
): DriftResult {
  // 以较粗的包络（50ms / 25ms）做互相关，抗音高差异
  const hopSec = 0.025
  const a = rmsEnvelope(sourceMono, { sampleRate, windowSec: 0.05, hopSec })
  const b = rmsEnvelope(studentMono, { sampleRate, windowSec: 0.05, hopSec })
  const n = Math.min(a.rms.length, b.rms.length)
  if (n < 8) return { delaySec: 0, confidence: 0, searchedRangeSec: maxDriftSec }

  const x = a.rms.subarray(0, n)
  const y = b.rms.subarray(0, n)
  const meanX = avg(x)
  const meanY = avg(y)
  const normX = norm(x, meanX)
  const normY = norm(y, meanY)
  if (normX === 0 || normY === 0) return { delaySec: 0, confidence: 0, searchedRangeSec: maxDriftSec }

  const maxLag = Math.min(n - 1, Math.round(maxDriftSec / hopSec))
  let bestLag = 0
  let bestCorr = -Infinity
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let corr = 0
    let cnt = 0
    for (let i = 0; i < n; i++) {
      const j = i + lag
      if (j < 0 || j >= n) continue
      corr += (x[i] - meanX) * (y[j] - meanY)
      cnt++
    }
    // 用重叠段长度修正，避免大滞后相关值被系统性低估
    corr = (corr / cnt / (normX * normY)) * (n / cnt)
    corr = Math.max(-1, Math.min(1, corr))
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }
  return {
    delaySec: Math.round(bestLag * hopSec * 1000) / 1000,
    confidence: Math.round(bestCorr * 1000) / 1000,
    searchedRangeSec: maxDriftSec
  }
}

function avg(a: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return s / a.length
}

function norm(a: Float32Array, mean: number): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - mean) * (a[i] - mean)
  return Math.sqrt(s / a.length)
}
