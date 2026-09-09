import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve, relative, extname } from 'node:path'
import { getRoots, stageImport, ensureWav, finalizeRecording, salvageRecording, inspectWav, sha256File, type MediaRoots } from './media-store'
import { writePartChunk, abandonPart, partExists, partSize } from './recording-io'
import { SettingsStore } from './settings'
import { ffmpegConfigured, probeMedia, type FfmpegConfig } from './ffmpeg'
import { packProject, unpackProject } from './package-io'
import type { PackageManifest } from '../shared/types'

interface MediaMetaInput {
  projectId: string
  kind: 'speech' | 'student' | 'reference' | 'aux'
  label: string
  assetId: string
  channels: 1 | 2
}

export function registerIpc(getWindow: () => BrowserWindow | null): { roots: MediaRoots } {
  const userData = app.getPath('userData')
  const roots = getRoots(userData)
  const settings = new SettingsStore(userData)

  const ffmpegCfg = (): FfmpegConfig | null => {
    const s = settings.get()
    if (!s.ffmpegPath) return null
    return { ffmpegPath: s.ffmpegPath, ffprobePath: s.ffprobePath || undefined, allowDirs: [roots.mediaDir] }
  }

  ipcMain.handle('app:getUserData', () => userData)

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch))
  ipcMain.handle('ffmpeg:status', () => {
    const cfg = ffmpegCfg()
    return { configured: ffmpegConfigured(cfg), settings: settings.get() }
  })
  ipcMain.handle('ffmpeg:probe', async (_e, abs: string) => {
    const cfg = ffmpegCfg()
    if (!cfg) throw new Error('未配置 FFmpeg')
    return probeMedia(cfg, abs)
  })

  ipcMain.handle('dialog:openAudio', async () => {
    const win = getWindow()
    const r = await dialog.showOpenDialog(win!, {
      title: '导入讲话音频',
      properties: ['openFile'],
      filters: [
        { name: '音频文件', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    return { path: p, name: p.split(/[\\/]/).pop()!, size: statSync(p).size }
  })

  ipcMain.handle('dialog:savePackage', async (_e, defaultName: string) => {
    const win = getWindow()
    const r = await dialog.showSaveDialog(win!, {
      title: '导出加密工程包',
      defaultPath: defaultName || 'project.sipkg',
      filters: [{ name: '加密工程包', extensions: ['sipkg'] }]
    })
    return r.canceled ? null : r.filePath
  })

  ipcMain.handle('dialog:openPackage', async () => {
    const win = getWindow()
    const r = await dialog.showOpenDialog(win!, {
      title: '导入加密工程包',
      properties: ['openFile'],
      filters: [{ name: '加密工程包', extensions: ['sipkg'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  /**
   * 导入媒体：复制进工程目录 -> 受限 FFmpeg 转 48k WAV -> 返回完整元数据。
   * 源采样率同时回传，便于"采样率不一致"复盘提示。
   */
  ipcMain.handle('media:import', async (_e, srcAbs: string, meta: MediaMetaInput) => {
    const originalName = srcAbs.split(/[\\/]/).pop() || 'audio'
    const staged = stageImport(roots, srcAbs, meta.assetId, meta.projectId, originalName)
    const origSha = sha256File(staged.origAbs)
    const origSize = statSync(staged.origAbs).size
    let sourceSampleRate: number | undefined
    if (extname(staged.origAbs).toLowerCase() === '.wav') {
      try { sourceSampleRate = inspectWav(staged.origAbs).sampleRate } catch { /* ignore */ }
    }
    const cfg = ffmpegCfg()
    if (!cfg && extname(staged.origAbs).toLowerCase() !== '.wav') {
      throw new Error('未配置 FFmpeg，无法转码非 WAV 音频。请在设置中指定 FFmpeg。')
    }
    const wav = await ensureWav(roots, cfg, meta.projectId, meta.assetId, staged.origAbs, meta.channels)
    const info = inspectWav(wav.wavAbs)
    if (!sourceSampleRate && wav.probe) {
      sourceSampleRate = wav.probe.streams.find((s) => s.codecType === 'audio')?.sampleRate
    }
    return {
      relPath: staged.origRel,
      wavRelPath: wav.wavRel,
      sha256: origSha,
      sizeBytes: origSize,
      sampleRate: info.sampleRate,
      channels: info.channels,
      durationSec: info.durationSec,
      sourceSampleRate,
      transcoded: wav.transcoded
    }
  })

  /** 复制外部文件字节到指定录音 part（用于会话开始时写 WAV 头/首块） */
  ipcMain.handle('recording:writeChunk', (_e, sessionId: string, data: ArrayBuffer | Uint8Array, isStart: boolean) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    return writePartChunk(roots, sessionId, bytes, isStart)
  })

  ipcMain.handle('recording:finish', (_e, sessionId: string) => finalizeRecording(roots, sessionId))
  ipcMain.handle('recording:abandon', (_e, sessionId: string) => abandonPart(roots, sessionId))
  ipcMain.handle('recording:salvage', (_e, sessionId: string) => salvageRecording(roots, sessionId))
  ipcMain.handle('recording:partExists', (_e, sessionId: string) => ({
    exists: partExists(roots, sessionId),
    size: partSize(roots, sessionId)
  }))

  ipcMain.handle('media:readWavBytes', (_e, relPath: string) => {
    const abs = resolve(roots.mediaDir, relPath)
    const rel = relative(roots.mediaDir, abs)
    if (rel.startsWith('..')) throw new Error('路径越界')
    if (!existsSync(abs)) throw new Error('媒体文件不存在')
    const buf = readFileSync(abs)
    // 返回拷贝，避免结构化克隆复用底层 Buffer
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle('package:exportEncrypted', (_e, outputPath: string, manifest: PackageManifest, passphrase: string) => {
    return packProject(roots, outputPath, manifest, passphrase)
  })

  ipcMain.handle('package:importEncrypted', (_e, inputPath: string, passphrase: string) => {
    return unpackProject(roots, inputPath, passphrase)
  })

  ipcMain.handle('dev:writeTestWav', (_e, abs: string, bytes: ArrayBuffer) => {
    // 仅在测试目录写合成 WAV，且限定在 media 目录下
    const target = resolve(abs)
    const rel = relative(roots.mediaDir, target)
    if (rel.startsWith('..') || !rel) throw new Error('路径越界')
    writeFileSync(target, Buffer.from(bytes))
    return target
  })

  return { roots }
}
