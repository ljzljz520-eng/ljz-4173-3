// 渲染端看到的桥 API 结构类型（不引入 electron 主类型，避免污染 DOM 编译）
export interface TrainerApi {
  getUserData(): Promise<string>
  settings: {
    get(): Promise<{ ffmpegPath: string; ffprobePath?: string }>
    set(patch: { ffmpegPath?: string; ffprobePath?: string }): Promise<unknown>
  }
  ffmpeg: {
    status(): Promise<{ configured: boolean; settings: { ffmpegPath: string } }>
    probe(abs: string): Promise<unknown>
  }
  dialog: {
    openAudio(): Promise<{ path: string; name: string; size: number } | null>
    savePackage(defaultName: string): Promise<string | null>
    openPackage(): Promise<string | null>
  }
  media: {
    importAudio(srcAbs: string, meta: {
      projectId: string
      kind: 'speech' | 'student' | 'reference' | 'aux'
      label: string
      assetId: string
      channels: 1 | 2
    }): Promise<{
      relPath: string
      wavRelPath: string
      sha256: string
      sizeBytes: number
      sampleRate: number
      channels: number
      durationSec: number
      sourceSampleRate?: number
      transcoded: boolean
    }>
    readWavBytes(relPath: string): Promise<ArrayBuffer>
    mediaUrl(relPath: string): string
  }
  recording: {
    writeChunk(sessionId: string, data: ArrayBuffer, isStart: boolean): Promise<number>
    finish(sessionId: string): Promise<{
      abs: string
      rel: string
      info: { sampleRate: number; channels: number; durationSec: number; dataOffset: number; dataByteLength: number }
      sha: string
      size: number
    }>
    abandon(sessionId: string): Promise<boolean>
    salvage(sessionId: string): Promise<{
      abs: string
      rel: string
      info: { sampleRate: number; channels: number; durationSec: number; dataOffset: number; dataByteLength: number }
      sha: string
      size: number
      note: string
    }>
    partExists(sessionId: string): Promise<{ exists: boolean; size: number }>
  }
  packageIO: {
    exportEncrypted(outputPath: string, manifest: unknown, passphrase: string): Promise<{ bytes: number; fileCount: number }>
    importEncrypted(inputPath: string, passphrase: string): Promise<{ manifest: any; written: string[] }>
  }
}

declare global {
  interface Window {
    trainer: TrainerApi
  }
}

export {}
