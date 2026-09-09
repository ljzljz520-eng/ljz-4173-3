import { createContext, useContext, useEffect, useState } from 'react'
import type { Role } from '../../shared/types'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectPage } from './pages/ProjectPage'
import { SettingsModal } from './components/SettingsModal'

type Route = { name: 'projects' } | { name: 'project'; id: string }

const RoleCtx = createContext<{ role: Role; setRole: (r: Role) => void }>({
  role: 'teacher', setRole: () => undefined
})
export const useRole = () => useContext(RoleCtx)

export function App() {
  const [role, setRole] = useState<Role>('teacher')
  const [route, setRoute] = useState<Route>({ name: 'projects' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null)

  async function refreshFfmpeg() {
    const s = await window.trainer.ffmpeg.status()
    setFfmpegOk(s.configured)
  }
  useEffect(() => { void refreshFfmpeg() }, [settingsOpen])

  return (
    <RoleCtx.Provider value={{ role, setRole }}>
      <div className="app">
        <header className="topbar">
          <span className="brand">🎧 同传训练复盘室</span>
          {route.name === 'project' && (
            <button onClick={() => setRoute({ name: 'projects' })}>← 返回工程列表</button>
          )}
          <span className="spacer" />
          <span className="pill">
            FFmpeg：{ffmpegOk === null ? '检测中…' : ffmpegOk ? <span className="ok-text">已配置</span> : <span className="error-text">未配置（仅支持 WAV）</span>}
          </span>
          <button onClick={() => setSettingsOpen(true)}>设置</button>
          <div className="role-switch">
            身份：
            <button className={role === 'teacher' ? 'active' : ''} onClick={() => setRole('teacher')}>教员</button>
            <button className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}>学员</button>
          </div>
        </header>
        {route.name === 'projects' ? (
          <ProjectsPage onOpen={(id) => setRoute({ name: 'project', id })} />
        ) : (
          <ProjectPage projectId={route.id} />
        )}
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </div>
    </RoleCtx.Provider>
  )
}
