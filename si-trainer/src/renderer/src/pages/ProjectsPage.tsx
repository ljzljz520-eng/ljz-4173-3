import { useEffect, useState } from 'react'
import { db, deleteProjectCascade, hasProject } from '../db'
import type { Project } from '../../../shared/types'
import { uid, formatClock } from '../../../shared/time'
import { ImportPackageModal } from '../components/ImportPackageModal'

export function ProjectsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [speaker, setSpeaker] = useState('')
  const [sl, setSl] = useState('zh')
  const [tl, setTl] = useState('en')
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const all = await db.projects.orderBy('updatedAt').reverse().toArray()
    setProjects(all)
  }
  useEffect(() => { void refresh() }, [])

  async function create() {
    if (!name.trim()) return
    const now = Date.now()
    const p: Project = {
      id: uid(), name: name.trim(), speaker: speaker.trim() || undefined,
      sourceLanguage: sl, targetLanguage: tl,
      createdAt: now, updatedAt: now, lastOpenedAt: now
    }
    await db.projects.add(p)
    setName(''); setSpeaker('')
    await refresh()
    onOpen(p.id)
  }

  async function remove(p: Project) {
    if (!confirm(`删除工程「${p.name}」的索引？\n本机音频文件需要在系统目录手动清理（或稍后清理向导）。`)) return
    setBusy(true)
    try { await deleteProjectCascade(p.id); await refresh() } finally { setBusy(false) }
  }

  async function touch(p: Project) {
    p.lastOpenedAt = Date.now()
    await db.projects.put(p)
    onOpen(p.id)
  }

  return (
    <div className="container">
      <div className="section card">
        <h2>新建训练工程</h2>
        <div className="row">
          <input placeholder="工程名称（如：9月9日 全会主旨同传）" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 260 }} />
          <input placeholder="讲话人（选填）" value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
          <input value={sl} onChange={(e) => setSl(e.target.value)} style={{ width: 70 }} title="源语言" />
          <span className="muted">→</span>
          <input value={tl} onChange={(e) => setTl(e.target.value)} style={{ width: 70 }} title="目标语言" />
          <button className="primary" disabled={!name.trim()} onClick={create}>创建并打开</button>
          <button onClick={() => setImportOpen(true)}>导入加密工程包…</button>
        </div>
      </div>

      <div className="section">
        <h2>工程索引（{projects.length}）</h2>
        {projects.length === 0 && <p className="muted">还没有工程。Dexie 仅保存索引，音频字节保存在本机 userData。</p>}
        <div className="grid">
          {projects.map((p) => (
            <div className="card" key={p.id}>
              <h3>{p.name}</h3>
              <div className="muted">
                {p.speaker ? `讲话人：${p.speaker} · ` : ''}{p.sourceLanguage} → {p.targetLanguage}
              </div>
              <div className="pill">
                创建 {new Date(p.createdAt).toLocaleString()} · 最近打开 {new Date(p.lastOpenedAt).toLocaleString()}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => touch(p)}>打开</button>
                <button className="danger" disabled={busy} onClick={() => remove(p)}>删除索引</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {importOpen && (
        <ImportPackageModal
          onClose={() => { setImportOpen(false); void refresh() }}
          onConflict={async (id) => await hasProject(id)}
        />
      )}
    </div>
  )
}

void formatClock
