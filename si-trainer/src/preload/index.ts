import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getUserData: (): Promise<string> => ipcRenderer.invoke('app:getUserData'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: { ffmpegPath?: string; ffprobePath?: string }) =>
      ipcRenderer.invoke('settings:set', patch)
  },
  ffmpeg: {
    status: () => ipcRenderer.invoke('ffmpeg:status'),
    probe: (abs: string) => ipcRenderer.invoke('ffmpeg:probe', abs)
  },
  dialog: {
    openAudio: () => ipcRenderer.invoke('dialog:openAudio'),
    savePackage: (defaultName: string) => ipcRenderer.invoke('dialog:savePackage', defaultName),
    openPackage: () => ipcRenderer.invoke('dialog:openPackage')
  },
  media: {
    importAudio: (
      srcAbs: string,
      meta: { projectId: string; kind: 'speech' | 'student' | 'reference' | 'aux'; label: string; assetId: string; channels: 1 | 2 }
    ) => ipcRenderer.invoke('media:import', srcAbs, meta),
    readWavBytes: (relPath: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('media:readWavBytes', relPath),
    mediaUrl: (relPath: string) => `secure-media://media/${relPath.split('/').map(encodeURIComponent).join('/')}`
  },
  recording: {
    writeChunk: (sid: string, data: ArrayBuffer, isStart: boolean): Promise<number> =>
      ipcRenderer.invoke('recording:writeChunk', sid, data, isStart),
    finish: (sessionId: string) => ipcRenderer.invoke('recording:finish', sessionId),
    abandon: (sessionId: string) => ipcRenderer.invoke('recording:abandon', sessionId),
    salvage: (sessionId: string) => ipcRenderer.invoke('recording:salvage', sessionId),
    partExists: (sessionId: string): Promise<{ exists: boolean; size: number }> =>
      ipcRenderer.invoke('recording:partExists', sessionId)
  },
  packageIO: {
    exportEncrypted: (outputPath: string, manifest: unknown, passphrase: string) =>
      ipcRenderer.invoke('package:exportEncrypted', outputPath, manifest, passphrase),
    importEncrypted: (inputPath: string, passphrase: string) =>
      ipcRenderer.invoke('package:importEncrypted', inputPath, passphrase)
  }
}

export type TrainerApi = typeof api

contextBridge.exposeInMainWorld('trainer', api)
