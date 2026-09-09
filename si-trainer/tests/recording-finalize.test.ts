import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getRoots, finalizeRecording } from '../src/main/media-store'
import { parseWavHeader, encodeWav } from '../src/shared/wav'
import { tone } from './helpers'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recfin-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('录音落盘收尾', () => {
  it('正常结束时回填流式占位 WAV 头，得到完整时长', () => {
    const roots = getRoots(dir)
    const sid = 'sess_test_1'
    // 模拟 StreamingWavWriter：写出完整 PCM，但头部 RIFF/data 尺寸为占位
    const wav = encodeWav([tone(16000, 300, 1.2, 0.5)], { sampleRate: 16000, channels: 1 })
    // StreamingWavWriter 的流式占位：RIFF 尺寸为 (36+0xffffffff) mod 2^32 = 35，data 尺寸为 0xffffffff
    wav.writeUInt32LE((36 + 0xffffffff) >>> 0, 4)
    wav.writeUInt32LE(0xffffffff, 40)
    mkdirSync(join(roots.mediaDir, 'recordings'), { recursive: true })
    writeFileSync(roots.recordingPart(sid), wav)

    const r = finalizeRecording(roots, sid)
    const fixed = readFileSync(r.abs)
    expect(fixed.readUInt32LE(4)).toBe(fixed.length - 8)
    expect(fixed.readUInt32LE(40)).toBe(r.info.dataByteLength)
    const info = parseWavHeader(fixed)
    expect(info.durationSec).toBeCloseTo(1.2, 2)
    expect(r.size).toBe(fixed.length)
    expect(r.sha).toMatch(/^[0-9a-f]{64}$/)
  })

  it('会话 id 非法字符不得穿越目录', () => {
    const roots = getRoots(dir)
    expect(() => roots.recordingPart('../evil')).toThrow(/非法路径段/)
  })
})
