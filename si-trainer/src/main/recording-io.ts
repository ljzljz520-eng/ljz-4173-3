import { existsSync, mkdirSync, statSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaRoots } from './media-store'

export function partPath(roots: MediaRoots, sessionId: string): string {
  return roots.recordingPart(sessionId)
}

export function partExists(roots: MediaRoots, sessionId: string): boolean {
  return existsSync(partPath(roots, sessionId))
}

export function partSize(roots: MediaRoots, sessionId: string): number {
  try { return statSync(partPath(roots, sessionId)).size } catch { return 0 }
}

/** 写入录音块；isStart 时新建（渲染端负责先写 WAV 头），后续追加 PCM */
export function writePartChunk(roots: MediaRoots, sessionId: string, data: Uint8Array, isStart: boolean): number {
  const p = partPath(roots, sessionId)
  mkdirSync(join(roots.mediaDir, 'recordings'), { recursive: true })
  if (isStart) writeFileSync(p, data)
  else appendFileSync(p, Buffer.from(data))
  return statSync(p).size
}

export function abandonPart(roots: MediaRoots, sessionId: string): boolean {
  const p = partPath(roots, sessionId)
  if (existsSync(p)) { rmSync(p, { force: true }); return true }
  return false
}
