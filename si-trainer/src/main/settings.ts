import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AppSettings {
  ffmpegPath: string
  ffprobePath?: string
}

const DEFAULTS: AppSettings = { ffmpegPath: '', ffprobePath: '' }

export class SettingsStore {
  private file: string
  private cache: AppSettings
  constructor(userData: string) {
    this.file = join(userData, 'settings.json')
    this.cache = { ...DEFAULTS }
    this.load()
  }
  private load(): void {
    try {
      if (existsSync(this.file)) Object.assign(this.cache, JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      // 损坏的设置文件回退默认值
      this.cache = { ...DEFAULTS }
    }
  }
  get(): AppSettings {
    return { ...this.cache }
  }
  set(patch: Partial<AppSettings>): AppSettings {
    this.cache = { ...this.cache, ...patch }
    writeFileSync(this.file, JSON.stringify(this.cache, null, 2), 'utf8')
    return this.get()
  }
}
