// WAV(PCM) 纯解析/编码：供主进程转码校验、截断修复与单元测试使用
// 不引入第三方音频库，渲染进程解码走 AudioContext.decodeAudioData。

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataOffset: number
  dataByteLength: number
  durationSec: number
  audioFormat: number
}

export class WavFormatError extends Error {}

function readAscii(buf: Buffer, off: number, len: number): string {
  return buf.toString('latin1', off, off + len)
}

function findChunk(buf: Buffer, start: number, end: number, id: string): { offset: number; size: number } | null {
  let p = start
  let guard = 0
  while (p + 8 <= end && guard++ < 1024) {
    const cid = readAscii(buf, p, 4)
    const size = buf.readUInt32LE(p + 4)
    if (cid === id) return { offset: p + 8, size }
    // 声明尺寸超过文件（流式占位 0xffffffff / 截断）时，扫描无法继续
    if (!Number.isFinite(size) || p + 8 + size > end) break
    // WAV chunk 按字对齐（pad to even）
    p += 8 + size + (size % 2)
  }
  return null
}

/** 解析 WAV 头；允许 data 尺寸声明大于实际（截断文件/流式占位），返回实际可用字节数 */
export function parseWavHeader(buf: Buffer): WavInfo {
  if (buf.length < 44 || readAscii(buf, 0, 4) !== 'RIFF' || readAscii(buf, 8, 4) !== 'WAVE') {
    throw new WavFormatError('不是合法的 RIFF/WAVE 文件')
  }
  // 标准布局：fmt chunk 位于偏移 12。优先按固定偏移读，避免占位/奇数 size 干扰通用扫描
  let fmt: { offset: number; size: number } | null = null
  if (readAscii(buf, 12, 4) === 'fmt ') {
    fmt = { offset: 20, size: buf.readUInt32LE(16) }
  } else {
    fmt = findChunk(buf, 12, buf.length, 'fmt ')
  }
  if (!fmt) throw new WavFormatError('缺少 fmt chunk')
  const audioFormat = buf.readUInt16LE(fmt.offset)
  const channels = buf.readUInt16LE(fmt.offset + 2)
  const sampleRate = buf.readUInt32LE(fmt.offset + 4)
  const bitsPerSample = buf.readUInt16LE(fmt.offset + 14)
  if (audioFormat !== 1 && audioFormat !== 3 && audioFormat !== 65534) {
    throw new WavFormatError(`不支持的音频格式 ${audioFormat}`)
  }
  // fmt 之后继续找 data（兼容 LIST 等可选 chunk；标准 16 字节 fmt 时 data 在偏移 36）
  let data: { offset: number; size: number } | null = null
  const afterFmt = fmt.offset + fmt.size + (fmt.size % 2)
  if (readAscii(buf, afterFmt, 4) === 'data') {
    data = { offset: afterFmt + 8, size: buf.readUInt32LE(afterFmt + 4) }
  } else {
    data = findChunk(buf, afterFmt, buf.length, 'data')
  }
  if (!data) throw new WavFormatError('缺少 data chunk')
  const actualBytes = Math.min(data.size, buf.length - data.offset)
  const bytesPerFrame = channels * (bitsPerSample / 8)
  if (bytesPerFrame <= 0) throw new WavFormatError('无效的位深/声道数')
  const validBytes = Math.floor(actualBytes / bytesPerFrame) * bytesPerFrame
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataOffset: data.offset,
    dataByteLength: validBytes,
    durationSec: validBytes / bytesPerFrame / sampleRate,
    audioFormat
  }
}

export interface DecodedPcm {
  info: WavInfo
  /** 交织前的各声道浮点采样 [-1,1] */
  channels: Float32Array[]
  frames: number
}

function pcmToFloat(buf: Buffer, off: number, bits: number, format: number): number {
  switch (bits) {
    case 8:
      // 8 位 PCM 为无符号
      return (buf.readUInt8(off) - 128) / 128
    case 16:
      return buf.readInt16LE(off) / 32768
    case 24: {
      const b0 = buf.readUInt8(off)
      const b1 = buf.readUInt8(off + 1)
      const b2 = buf.readUInt8(off + 2)
      let v = b0 | (b1 << 8) | (b2 << 16)
      if (v & 0x800000) v |= ~0xffffff
      return v / 8388608
    }
    case 32:
      if (format === 3) return buf.readFloatLE(off)
      return buf.readInt32LE(off) / 2147483648
    default:
      throw new WavFormatError(`不支持的位深 ${bits}`)
  }
}

/** 解码为去交织的多声道浮点数据（自动忽略不完整帧） */
export function decodeWav(buf: Buffer): DecodedPcm {
  const info = parseWavHeader(buf)
  const bpf = info.channels * (info.bitsPerSample / 8)
  const frames = Math.floor(info.dataByteLength / bpf)
  const out = Array.from({ length: info.channels }, () => new Float32Array(frames))
  let p = info.dataOffset
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < info.channels; c++) {
      out[c][f] = pcmToFloat(buf, p, info.bitsPerSample, info.audioFormat)
      p += info.bitsPerSample / 8
    }
  }
  return { info, channels: out, frames }
}

export interface WavEncodeOptions {
  sampleRate: number
  channels: number
  bitsPerSample?: 16 | 24 | 32
  float32?: boolean
}

/** 编码多声道浮点数据为 16/24/32 位 PCM（或 32-bit float）WAV Buffer */
export function encodeWav(channels: Float32Array[], opts: WavEncodeOptions): Buffer {
  const { sampleRate, channels: ch } = opts
  const bits = opts.float32 ? 32 : opts.bitsPerSample ?? 16
  const frames = channels[0]?.length ?? 0
  const bpf = ch * (bits / 8)
  const dataLen = frames * bpf
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0, 'latin1')
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8, 'latin1')
  buf.write('fmt ', 12, 'latin1')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(opts.float32 ? 3 : 1, 20)
  buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * bpf, 28)
  buf.writeUInt16LE(bpf, 32)
  buf.writeUInt16LE(bits, 34)
  buf.write('data', 36, 'latin1')
  buf.writeUInt32LE(dataLen, 40)
  let p = 44
  const writeSample = (v: number) => {
    const x = Math.max(-1, Math.min(1, v))
    if (opts.float32) {
      buf.writeFloatLE(x, p)
      p += 4
    } else if (bits === 16) {
      buf.writeInt16LE(Math.round(x * 32767), p)
      p += 2
    } else if (bits === 24) {
      const n = Math.round(x * 8388607)
      buf.writeUInt8(n & 0xff, p)
      buf.writeUInt8((n >> 8) & 0xff, p + 1)
      buf.writeUInt8((n >> 16) & 0xff, p + 2)
      p += 3
    } else {
      buf.writeInt32LE(Math.round(x * 2147483647), p)
      p += 4
    }
  }
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < ch; c++) writeSample(channels[c][f] ?? 0)
  }
  return buf
}

/**
 * 修复截断的录音 WAV：
 * 保留完整 PCM 帧，重写 RIFF/data 尺寸。返回新 Buffer（若无损坏原样返回）。
 */
export function salvageWav(buf: Buffer): { buffer: Buffer; repaired: boolean; note?: string } {
  try {
    const info = parseWavHeader(buf)
    const bpf = info.channels * (info.bitsPerSample / 8)
    const declaredData = buf.readUInt32LE(40)
    const expectedLen = info.dataOffset + declaredData + (declaredData % 2)
    // 完整文件：实际长度符合（含可能的 1 字节 chunk 对齐填充）且两个尺寸字段自洽
    const consistent =
      declaredData === info.dataByteLength &&
      buf.length === expectedLen &&
      buf.readUInt32LE(4) === buf.length - 8
    if (consistent) return { buffer: buf, repaired: false }
    const validData = info.dataByteLength
    const out = Buffer.alloc(info.dataOffset + validData)
    buf.copy(out, 0, 0, out.length)
    out.writeUInt32LE(out.length - 8, 4)
    out.writeUInt32LE(validData, 40)
    const recoveredSec = validData / bpf / info.sampleRate
    return {
      buffer: out,
      repaired: true,
      note: `录音意外终止：已丢弃不完整帧，恢复 ${recoveredSec.toFixed(2)}s 有效音频`
    }
  } catch (e) {
    throw new WavFormatError(`无法修复 WAV: ${(e as Error).message}`)
  }
}

/** 线性重采样（转码兜底/测试用；生产转码以 FFmpeg 为准） */
export function linearResample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice()
  const ratio = fromRate / toRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = input[i0] ?? 0
    const b = input[i0 + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const out = new Float32Array(n)
  for (const ch of channels) {
    for (let i = 0; i < n; i++) out[i] += ch[i] ?? 0
  }
  for (let i = 0; i < n; i++) out[i] /= channels.length
  return out
}
