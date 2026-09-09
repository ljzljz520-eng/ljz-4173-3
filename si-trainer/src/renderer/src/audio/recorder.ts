// 学员声道录音：
// - 记录设备 label / deviceId / 实际采样率 / 声道数；
// - 每 1s 把 PCM 增量写入主进程（userData，不上云）；
// - 设备掉线/进程终止时 .part 保留，下次进入工程提示修复。

import { StreamingWavWriter } from './wav-writer'
import type { RecordingSession } from '../../../shared/types'
import { uid } from '../../../shared/time'

export interface RecorderOptions {
  projectId: string
  label: string
  deviceId: string
  deviceLabel: string
  onError?: (e: Error) => void
}

export class Recorder {
  session: RecordingSession
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private writer: StreamingWavWriter | null = null
  private channels = 1
  private framesSinceFlush = 0
  private flushFrames = 0
  private collectedFrames = 0
  private pendingWrites = 0
  private started = false
  private ended = false
  private deviceEndedHandler: (() => void) | null = null

  constructor(private opts: RecorderOptions) {
    this.session = {
      id: uid(),
      projectId: opts.projectId,
      label: opts.label,
      deviceLabel: opts.deviceLabel,
      deviceId: opts.deviceId,
      sampleRate: 0,
      channels: 1,
      startedAt: Date.now(),
      terminatedAbruptly: false
    }
  }

  async start(): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: this.opts.deviceId ? { exact: this.opts.deviceId } : undefined,
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    }
    this.stream = await navigator.mediaDevices.getUserMedia(constraints)
    const track = this.stream.getAudioTracks()[0]
    const settings = track.getSettings()
    // 实际采样率以 AudioContext 为准；设备声明采样率记录在 deviceLabel 附注
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.session.sampleRate = this.ctx.sampleRate
    this.channels = settings.channelCount && settings.channelCount > 1 ? 2 : 1
    this.session.channels = this.channels
    if (settings.sampleRate && settings.sampleRate !== this.ctx.sampleRate) {
      this.session.salvageNote =
        `设备采样率 ${settings.sampleRate}Hz 与 AudioContext ${this.ctx.sampleRate}Hz 不一致，按 ${this.ctx.sampleRate}Hz 存储`
    }

    this.writer = new StreamingWavWriter(this.ctx.sampleRate, this.channels)
    await window.trainer.recording.writeChunk(this.session.id, this.writer.initialChunk(), true)

    const bufSize = 4096
    this.processor = this.ctx.createScriptProcessor(bufSize, this.channels, this.channels)
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.source.connect(this.processor)
    // ScriptProcessor 必须连到 destination 才会回调（零增益不发声）
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    this.processor.connect(mute).connect(this.ctx.destination)

    this.flushFrames = this.ctx.sampleRate // 每秒落盘一次
    this.collectedFrames = 0
    this.processor.onaudioprocess = (e) => {
      if (!this.started || this.ended || !this.writer) return
      const inputs: Float32Array[] = []
      for (let c = 0; c < this.channels; c++) inputs.push(e.inputBuffer.getChannelData(c).slice())
      const data = this.writer.encode(inputs)
      // 证据完整性：不丢弃任何 PCM 块；极端积压（磁盘异常）时提示而非静默丢帧
      this.pendingWrites++
      if (this.pendingWrites > 200) {
        this.opts.onError?.(new Error(`磁盘写入积压 ${this.pendingWrites} 块，请检查磁盘空间`))
      }
      void window.trainer.recording.writeChunk(this.session.id, data, false)
        .catch((err) => { this.opts.onError?.(err instanceof Error ? err : new Error(String(err))) })
        .finally(() => { this.pendingWrites-- })
      this.collectedFrames += bufSize
      this.framesSinceFlush += bufSize
      if (this.framesSinceFlush >= this.flushFrames) this.framesSinceFlush = 0
    }

    this.deviceEndedHandler = () => {
      // 录音设备突然拔出/掉线
      this.session.terminatedAbruptly = true
      this.opts.onError?.(new Error('录音设备掉线，录音已标记为意外终止'))
      this.stopInternal(true).catch(() => undefined)
    }
    track.addEventListener('ended', this.deviceEndedHandler)
    this.started = true
  }

  /** 正常停止：主进程做头校验（尺寸其实由 salvage 兜底） */
  async stop(): Promise<RecordingSession> {
    return this.stopInternal(false)
  }

  private async stopInternal(abrupt: boolean): Promise<RecordingSession> {
    if (this.ended) return this.session
    this.ended = true
    this.started = false
    // 等待在途增量写盘完成（最多 3s）
    const deadline = Date.now() + 3000
    while (this.pendingWrites > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    try { this.processor?.disconnect() } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.ctx) await this.ctx.close().catch(() => undefined)
    if (abrupt || this.session.terminatedAbruptly) {
      const r = await window.trainer.recording.salvage(this.session.id)
      this.session.terminatedAbruptly = true
      this.session.endedAt = Date.now()
      this.session.durationSec = r.info.durationSec
      this.session.sha256 = r.sha
      this.session.sizeBytes = r.size
      this.session.salvageNote = r.note
    } else {
      const r = await window.trainer.recording.finish(this.session.id)
      this.session.endedAt = Date.now()
      this.session.durationSec = r.info.durationSec
      this.session.sha256 = r.sha
      this.session.sizeBytes = r.size
    }
    return this.session
  }

  /** 放弃录音，删除临时文件 */
  async abandon(): Promise<void> {
    this.ended = true
    this.started = false
    try { this.processor?.disconnect() } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.ctx) await this.ctx.close().catch(() => undefined)
    await window.trainer.recording.abandon(this.session.id)
  }

  /** 已采集时长（按实际帧数，采样率随元数据保存） */
  get elapsedSec(): number {
    if (!this.session.sampleRate) return 0
    return this.collectedFrames / this.session.sampleRate
  }
}
