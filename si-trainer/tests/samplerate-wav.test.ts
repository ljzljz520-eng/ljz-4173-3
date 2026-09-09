import { describe, it, expect } from 'vitest'
import {
  parseWavHeader, decodeWav, encodeWav, salvageWav, linearResample, WavFormatError
} from '../src/shared/wav'
import { tone, makeWav, silence } from './helpers'

describe('WAV 解析 / 采样率不一致', () => {
  it('round-trip：44.1k 双声道 16-bit', () => {
    const ch1 = tone(44100, 440, 0.5)
    const ch2 = tone(44100, 660, 0.5, 0.3)
    const buf = makeWav(44100, [ch1, ch2])
    const info = parseWavHeader(buf)
    expect(info.sampleRate).toBe(44100)
    expect(info.channels).toBe(2)
    expect(info.bitsPerSample).toBe(16)
    expect(info.durationSec).toBeCloseTo(0.5, 2)
    const dec = decodeWav(buf)
    expect(dec.channels.length).toBe(2)
    expect(dec.frames).toBe(ch1.length)
  })

  it('线性重采样保持时长比例（48k -> 16k，采样率不一致场景）', () => {
    const a = tone(48000, 300, 1, 0.5)
    const b = linearResample(a, 48000, 16000)
    expect(b.length).toBeCloseTo(a.length / 3, 0)
    // 直流/缓变信号幅度保持
    const dc = new Float32Array(4800).fill(0.5)
    const dc16 = linearResample(dc, 48000, 16000)
    expect(Math.abs(dc16[800] - 0.5)).toBeLessThan(1e-6)
  })

  it('转码元数据可识别源与目标采样率差异（由主进程填充 sourceSampleRate）', () => {
    const buf = makeWav(22050, [tone(22050, 200, 0.2)])
    const info = parseWavHeader(buf)
    expect(info.sampleRate).toBe(22050)
    // 统一目标 48k（真实转码走 FFmpeg），这里验证重采样长度
    const dec = decodeWav(buf)
    const up = linearResample(dec.channels[0], 22050, 48000)
    expect(up.length).toBeGreaterThan(dec.frames)
  })
})

describe('录音突然终止：截断 WAV 修复', () => {
  it('修复被截断的 data 并丢弃不完整帧', () => {
    const buf = makeWav(16000, [tone(16000, 300, 2, 0.5)])
    // 模拟写入中断：只保留 70% 字节，且截断点落在帧中间（奇数偏移）
    const cut = Math.floor(buf.length * 0.7) - 1
    const broken = buf.subarray(0, cut)
    const { buffer: fixed, repaired, note } = salvageWav(broken)
    expect(repaired).toBe(true)
    expect(note).toContain('恢复')
    const info = parseWavHeader(fixed)
    // 修复后尺寸自洽
    expect(fixed.length).toBe(info.dataOffset + info.dataByteLength)
    expect(info.dataByteLength % (info.channels * 2)).toBe(0)
    expect(info.durationSec).toBeGreaterThan(1.2)
    expect(info.durationSec).toBeLessThan(2)
  })

  it('完好文件不重复修复', () => {
    const buf = makeWav(8000, [silence(8000, 0.1)])
    const { repaired } = salvageWav(buf)
    expect(repaired).toBe(false)
  })

  it('损坏到没有 RIFF 头时抛错', () => {
    expect(() => salvageWav(Buffer.from('not a wav file at all'))).toThrow(WavFormatError)
  })
})
