// 在渲染端把采样数据编码为 16-bit PCM WAV。
// 采用"先写有效头 + 增量追加 PCM"策略：若应用突然终止，
// 主进程 salvageRecording 会重写 RIFF/data 尺寸并丢弃不完整帧。

export class StreamingWavWriter {
  private header: ArrayBuffer
  private view: DataView
  readonly bytesPerSample = 2

  constructor(
    public readonly sampleRate: number,
    public readonly channels: number
  ) {
    this.header = new ArrayBuffer(44)
    this.view = new DataView(this.header)
    this.writeHeader() // data 尺寸先写 0xffffffff，结束时由主进程按实际字节回填
  }

  private writeHeader(): void {
    const v = this.view
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
    }
    writeStr(0, 'RIFF')
    // RIFF 尺寸占位（mod 2^32 回绕为 35）；真实尺寸主进程结束时回填
    v.setUint32(4, (36 + 0xffffffff) >>> 0, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true) // PCM
    v.setUint16(22, this.channels, true)
    v.setUint32(24, this.sampleRate, true)
    const blockAlign = this.channels * 2
    v.setUint32(28, this.sampleRate * blockAlign, true)
    v.setUint16(32, blockAlign, true)
    v.setUint16(34, 16, true)
    writeStr(36, 'data')
    // 占位：实际字节数，parseWavHeader 会截断到文件真实长度
    v.setUint32(40, 0xffffffff, true)
  }

  initialChunk(): ArrayBuffer {
    return this.header.slice(0)
  }

  /** 交织浮点采样 -> 16-bit PCM */
  encode(planar: Float32Array[]): ArrayBuffer {
    const frames = planar[0]?.length ?? 0
    const buf = new ArrayBuffer(frames * this.channels * 2)
    const dv = new DataView(buf)
    let p = 0
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < this.channels; c++) {
        let s = planar[c]?.[f] ?? 0
        s = Math.max(-1, Math.min(1, s))
        dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true)
        p += 2
      }
    }
    return buf
  }
}
