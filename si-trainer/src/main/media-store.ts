// 本机媒体存储：所有录音与导入文件只写入应用 userData 目录，不上传云端。
// 结构：
//   userData/media/projects/<projectId>/orig/<assetId>.<ext>
//   userData/media/projects/<projectId>/wav/<assetId>.wav
//   userData/media/recordings/<sessionId>.wav（录制中增量写入，带 .part 后缀）
//   userData/media/_staging/<id>.<ext>（导入临时区，IPC 可访问）

import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, renameSync, copyFileSync, rmSync, writeFileSync
} from 'node:fs'
import { join, resolve, relative, extname, basename } from 'node:path'
import { parseWavHeader, salvageWav } from '../shared/wav'
import type { WavInfo } from '../shared/wav'
import { transcodeToWav, probeMedia, type FfmpegConfig } from './ffmpeg'

export class PathViolation extends Error {}

export function assertInside(base: string, target: string): string {
  const rel = relative(base, target)
  if (rel === '' || rel.startsWith('..') || isAbsoluteJs(rel)) {
    throw new PathViolation('路径越界')
  }
  return rel
}

function isAbsoluteJs(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)
}

export interface MediaRoots {
  mediaDir: string
  projectDir: (projectId: string) => string
  stagingDir: string
  recordingPart: (sessionId: string) => string
  recordingFinal: (sessionId: string) => string
}

export function getRoots(userData: string): MediaRoots {
  const mediaDir = join(userData, 'media')
  const ensure = (d: string) => { mkdirSync(d, { recursive: true }); return d }
  return {
    mediaDir,
    projectDir: (projectId: string) => {
      const d = join(mediaDir, 'projects', safeSegment(projectId))
      ensure(join(d, 'orig'))
      ensure(join(d, 'wav'))
      return d
    },
    stagingDir: ensure(join(mediaDir, '_staging')),
    recordingPart: (sessionId: string) => join(mediaDir, 'recordings', `${safeSegment(sessionId)}.wav.part`),
    recordingFinal: (sessionId: string) => join(mediaDir, 'recordings', `${safeSegment(sessionId)}.wav`)
  }
}

export function safeSegment(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new PathViolation(`非法路径段: ${s}`)
  return s
}

export function sha256File(path: string): string {
  const h = createHash('sha256')
  h.update(readFileSync(path))
  return h.digest('hex')
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

export function inspectWav(path: string): WavInfo {
  return parseWavHeader(readFileSync(path))
}

/** 把用户选择的源文件复制进工程目录（不移动用户原件） */
export function stageImport(roots: MediaRoots, srcAbs: string, assetId: string, projectId: string, originalName: string): {
  origRel: string
  origAbs: string
} {
  const d = roots.projectDir(projectId)
  const ext = extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin'
  const origAbs = join(d, 'orig', `${safeSegment(assetId)}${ext}`)
  copyFileSync(srcAbs, origAbs)
  return { origRel: relative(roots.mediaDir, origAbs), origAbs }
}

/** 转码为统一 48k WAV；返回相对媒体根路径。无 FFmpeg 且源本身是 WAV 时回退直接复制 */
export async function ensureWav(
  roots: MediaRoots,
  cfg: FfmpegConfig | null,
  projectId: string,
  assetId: string,
  origAbs: string,
  channels: 1 | 2
): Promise<{ wavRel: string; wavAbs: string; transcoded: boolean; probe?: Awaited<ReturnType<typeof probeMedia>> }> {
  const d = roots.projectDir(projectId)
  const wavAbs = join(d, 'wav', `${safeSegment(assetId)}.wav`)
  const isWav = extname(origAbs).toLowerCase() === '.wav'
  if (cfg && cfg.ffmpegPath) {
    const probe = await probeMedia(cfg, origAbs)
    await transcodeToWav(cfg, origAbs, wavAbs, channels)
    return { wavRel: relative(roots.mediaDir, wavAbs), wavAbs, transcoded: true, probe }
  }
  if (isWav) {
    copyFileSync(origAbs, wavAbs)
    return { wavRel: relative(roots.mediaDir, wavAbs), wavAbs, transcoded: false }
  }
  throw new Error('未配置 FFmpeg，无法转码非 WAV 音频。请在设置中指定 FFmpeg 可执行文件。')
}

/** 回填标准 WAV 尺寸字段（录音流式写出时头部为占位长度），返回最终文件信息 */
function rewriteWavSizes(abs: string): WavInfo {
  const buf = readFileSync(abs)
  const info = parseWavHeader(buf)
  const expected = info.dataOffset + info.dataByteLength + (info.dataByteLength % 2)
  const needRewrite =
    buf.readUInt32LE(40) !== info.dataByteLength ||
    buf.readUInt32LE(4) !== buf.length - 8 ||
    buf.length !== expected
  if (needRewrite) {
    const out = Buffer.alloc(info.dataOffset + info.dataByteLength)
    buf.copy(out, 0, 0, out.length)
    out.writeUInt32LE(out.length - 8, 4)
    out.writeUInt32LE(info.dataByteLength, 40)
    writeFileSync(abs, out)
  }
  return parseWavHeader(readFileSync(abs))
}

/** 录音正常结束：.part -> .wav，回填尺寸并校验摘要 */
export function finalizeRecording(roots: MediaRoots, sessionId: string): {
  abs: string
  rel: string
  info: WavInfo
  sha: string
  size: number
} {
  const part = roots.recordingPart(sessionId)
  const final = roots.recordingFinal(sessionId)
  mkdirSync(join(roots.mediaDir, 'recordings'), { recursive: true })
  if (!existsSync(part)) throw new Error(`录音临时文件不存在: ${basename(part)}`)
  rmSync(final, { force: true })
  renameSync(part, final)
  const info = rewriteWavSizes(final)
  return { abs: final, rel: relative(roots.mediaDir, final), info, sha: sha256File(final), size: info.dataOffset + info.dataByteLength }
}

/**
 * 录音突然终止后的修复：
 * 重写截断 WAV 的尺寸字段并丢弃不完整帧，返回修复说明。
 */
export function salvageRecording(roots: MediaRoots, sessionId: string): {
  abs: string
  rel: string
  info: WavInfo
  sha: string
  size: number
  note: string
} {
  const part = roots.recordingPart(sessionId)
  const final = roots.recordingFinal(sessionId)
  mkdirSync(join(roots.mediaDir, 'recordings'), { recursive: true })
  if (!existsSync(part)) throw new Error('没有可恢复的录音临时文件')
  const { buffer, note } = salvageWav(readFileSync(part))
  // 原子性尽量：写新文件后删 part
  writeFileSync(final, buffer)
  rmSync(part, { force: true })
  const info = inspectWav(final)
  return {
    abs: final,
    rel: relative(roots.mediaDir, final),
    info,
    sha: sha256File(final),
    size: buffer.length,
    note: note ?? '录音文件已修复'
  }
}

export function removeMedia(roots: MediaRoots, relFromMedia: string): void {
  const abs = resolve(roots.mediaDir, relFromMedia)
  assertInside(roots.mediaDir, abs)
  rmSync(abs, { force: true })
}

export function removeProjectMedia(roots: MediaRoots, projectId: string): void {
  rmSync(roots.projectDir(projectId), { recursive: true, force: true })
}

export { resolve as resolvePath, join as joinPath }
