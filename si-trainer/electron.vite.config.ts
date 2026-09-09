import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// 生产环境注入严格 CSP；开发环境放开 localhost 以便 HMR
function cspPlugin(isDev: boolean): Plugin {
  const prod =
    "default-src 'self'; media-src 'self' secure-media:; img-src 'self' data:; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' secure-media:; " +
    "object-src 'none'; base-uri 'none'; worker-src 'self'"
  const dev =
    "default-src 'self'; script-src 'self' 'unsafe-inline' http://localhost:*; " +
    "style-src 'self' 'unsafe-inline'; media-src 'self' secure-media: blob:; " +
    "connect-src 'self' secure-media: http://localhost:* ws://localhost:*; object-src 'none'"
  return {
    name: 'csp-inject',
    transformIndexHtml(html) {
      return html.replace('%CSP%', isDev ? dev : prod)
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    plugins: [react(), cspPlugin(Boolean(process.env.VITE_DEV_SERVER_URL) || false)]
  }
})
