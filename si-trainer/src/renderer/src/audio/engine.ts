// Web Audio API 播放引擎：
// 原语音 / 学员译音 / 参考音频各自解码为 AudioBuffer，
// 按轨道偏移（漂移校准结果）做 lookahead 调度，共享同一条主时间轴。

export interface Track {
  id: string
  label: string
  buffer: AudioBuffer
  /** 轨道偏移（秒）：播放时刻 = 主时间轴时间 + offsetSec */
  offsetSec: number
  gain: number
  muted: boolean
  color: string
}

export interface EngineState {
  playing: boolean
  timeSec: number
  durationSec: number
}

const LOOKAHEAD_SEC = 0.1
const TICK_MS = 25

export class AudioEngine {
  private ctx: AudioContext
  private tracks = new Map<string, Track>()
  private master: GainNode
  private sources: AudioBufferSourceNode[] = []
  private gains: GainNode[] = []
  private startedAt = 0 // ctx.currentTime of timeline 0
  private playing = false
  private timer: number | null = null
  private timelineStart = 0 // 主时间轴起点（秒）
  private duration = 0
  private listeners = new Set<(s: EngineState) => void>()
  private endFired = false

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
  }

  get sampleRate(): number { return this.ctx.sampleRate }

  addTrack(t: Track): void {
    const end = t.offsetSec + t.buffer.duration
    if (end > this.duration) this.duration = end
    this.tracks.set(t.id, t)
    this.emit()
  }

  updateTrack(id: string, patch: Partial<Pick<Track, 'offsetSec' | 'gain' | 'muted'>>): void {
    const t = this.tracks.get(id)
    if (!t) return
    Object.assign(t, patch)
    if (patch.offsetSec !== undefined) {
      this.duration = 0
      for (const tr of this.tracks.values()) {
        this.duration = Math.max(this.duration, tr.offsetSec + tr.buffer.duration)
      }
    }
    if (this.playing) {
      // 实时增益/静音
      const idx = [...this.tracks.keys()].indexOf(id)
      if (idx >= 0 && this.gains[idx]) {
        const g = this.gains[idx]
        g.gain.setTargetAtTime(t.muted ? 0 : t.gain, this.ctx.currentTime, 0.01)
      }
    }
    this.emit()
  }

  getTracks(): Track[] { return [...this.tracks.values()] }
  getDuration(): number { return this.duration }

  async decode(wav: ArrayBuffer): Promise<AudioBuffer> {
    // 统一解码到 AudioContext 采样率；自动处理采样率不一致
    return await this.ctx.decodeAudioData(wav.slice(0))
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  play(fromSec?: number): void {
    if (this.playing) this.stopSources()
    const t0 = fromSec ?? this.timelineStart
    this.timelineStart = t0
    this.playing = true
    this.endFired = false
    this.startedAt = this.ctx.currentTime + 0.05
    this.sources = []
    this.gains = []
    for (const tr of this.tracks.values()) {
      const src = this.ctx.createBufferSource()
      src.buffer = tr.buffer
      const g = this.ctx.createGain()
      g.gain.value = tr.muted ? 0 : tr.gain
      src.connect(g)
      g.connect(this.master)
      // 轨道在主时间轴的 [start,end] 区间出现
      const trackStartsAt = this.startedAt + (tr.offsetSec - t0)
      const offsetIntoBuffer = Math.max(0, t0 - tr.offsetSec)
      if (trackStartsAt >= this.startedAt - 0.001) {
        src.start(Math.max(this.startedAt, trackStartsAt), offsetIntoBuffer)
      } else {
        // 轨道起点早于播放头：从缓冲区中部开始
        src.start(this.startedAt, offsetIntoBuffer)
      }
      this.sources.push(src)
      this.gains.push(g)
    }
    this.loop()
    this.emit()
  }

  pause(): void {
    this.timelineStart = this.getTime()
    this.stopSources()
    this.emit()
  }

  seek(sec: number): void {
    const t = Math.max(0, Math.min(this.duration, sec))
    this.timelineStart = t
    if (this.playing) this.play(t)
    else this.emit()
  }

  getTime(): number {
    if (!this.playing) return this.timelineStart
    return this.timelineStart + (this.ctx.currentTime - this.startedAt)
  }

  setMasterGain(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
  }

  onTick(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  isPlaying(): boolean { return this.playing }

  private loop = (): void => {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = window.setInterval(() => {
      const now = this.getTime()
      if (now >= this.duration && !this.endFired) {
        this.endFired = true
        this.timelineStart = 0
        this.stopSources()
        this.emit()
        return
      }
      this.emit()
    }, TICK_MS)
    void LOOKAHEAD_SEC
  }

  private stopSources(): void {
    this.playing = false
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null }
    for (const s of this.sources) {
      try { s.onended = null; s.stop() } catch { /* 已停止 */ }
      try { s.disconnect() } catch { /* ignore */ }
    }
    this.sources = []
    this.gains = []
  }

  private emit(): void {
    const state: EngineState = {
      playing: this.playing,
      timeSec: this.getTime(),
      durationSec: this.duration
    }
    for (const fn of this.listeners) fn(state)
  }

  dispose(): void {
    this.stopSources()
    this.listeners.clear()
    this.ctx.close().catch(() => undefined)
  }
}
