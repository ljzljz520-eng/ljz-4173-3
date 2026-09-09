import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync, statSync } from 'node:fs'
import { registerIpc } from './ipc'
import { getRoots } from './media-store'

let mainWindow: BrowserWindow | null = null

// 安全媒体协议：secure-media://media/<相对路径>，仅允许读取 userData/media
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'secure-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
  }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '同声传译训练复盘室',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 外部链接交给系统浏览器，应用内不导航到任意外部地址
    if (/^https?:\/\//.test(url)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow!.webContents.getURL()) e.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

function registerMediaProtocol(): void {
  const mediaDir = getRoots(app.getPath('userData')).mediaDir
  protocol.handle('secure-media', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'media') return new Response('Forbidden', { status: 403 })
      const decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const abs = join(mediaDir, decoded)
      const rel = relative(mediaDir, abs)
      if (rel.startsWith('..') || !rel) return new Response('Forbidden', { status: 403 })
      if (!existsSync(abs) || !statSync(abs).isFile()) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc(() => mainWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
