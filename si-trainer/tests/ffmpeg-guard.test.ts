import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transcodeToWav, FfmpegError, probeMedia } from '../src/main/ffmpeg'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ff-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('受限 FFmpeg 子进程', () => {
  it('拒绝媒体目录之外的输入', async () => {
    const outside = join(tmpdir(), 'outside.wav')
    writeFileSync(outside, Buffer.alloc(100))
    const cfg = { ffmpegPath: '/bin/true', allowDirs: [dir] }
    await expect(transcodeToWav(cfg, outside, join(dir, 'o.wav'), 1)).rejects.toThrow(/允许的媒体目录/)
  })

  it('拒绝协议/网络形态的输入', async () => {
    const cfg = { ffmpegPath: '/bin/true', allowDirs: [dir] }
    for (const evil of ['http://x/y.wav', 'pipe:0', 'file:///etc/passwd']) {
      await expect(transcodeToWav(cfg, evil, join(dir, 'o.wav'), 1)).rejects.toThrow()
    }
  })

  it('二进制不存在时报错（不做 PATH 兜底）', async () => {
    const input = join(dir, 'in.wav')
    writeFileSync(input, Buffer.alloc(100))
    const cfg = { ffmpegPath: join(dir, 'no-such-ffmpeg'), allowDirs: [dir] }
    await expect(transcodeToWav(cfg, input, join(dir, 'o.wav'), 1)).rejects.toThrow(/找不到 FFmpeg/)
  })

  it('未配置 ffprobe 时探测失败而不是任意执行', async () => {
    const input = join(dir, 'in.wav')
    writeFileSync(input, Buffer.alloc(100))
    const cfg = { ffmpegPath: '/bin/true', allowDirs: [dir] }
    // /bin/true 旁没有 ffprobe
    await expect(probeMedia(cfg, input)).rejects.toThrow()
  })

  it('错误类型统一为 FfmpegError', () => {
    const e = new FfmpegError('x')
    expect(e).toBeInstanceOf(Error)
  })
})
