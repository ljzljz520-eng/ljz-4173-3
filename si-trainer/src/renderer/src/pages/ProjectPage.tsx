import { useCallback, useEffect, useMemo, useState } from 'react'
import { db, loadBundle, type FullProjectBundle } from '../db'
import type { MediaAsset } from '../../../shared/types'
import { MaterialsTab } from './MaterialsTab'
import { RecordTab } from './RecordTab'
import { ReviewTab } from './ReviewTab'
import { ExportPackModal } from '../components/ExportPackModal'

type Tab = 'materials' | 'record' | 'review'

export function ProjectPage({ projectId }: { projectId: string }) {
  const [bundle, setBundle] = useState<FullProjectBundle | null>(null)
  const [tab, setTab] = useState<Tab>('materials')
  const [exportOpen, setExportOpen] = useState(false)
  const [salvaged, setSalvaged] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const b = await loadBundle(projectId)
    setBundle(b)
    const p = await db.projects.get(projectId)
    if (p) { p.lastOpenedAt = Date.now(); await db.projects.put(p) }
  }, [projectId])

  useEffect(() => { void refresh() }, [refresh])

  const addAsset = useCallback(async (a: MediaAsset) => {
    await db.assets.put(a)
    await touch(projectId)
    await refresh()
  }, [refresh])

  const updateAsset = useCallback(async (a: MediaAsset) => {
    await db.assets.put(a)
    await refresh()
  }, [refresh])

  const recordingAssets = useMemo(
    () => bundle?.assets.filter((a) => a.kind === 'student') ?? [],
    [bundle]
  )

  if (!bundle) return <div className="container muted">加载工程中…</div>

  return (
    <div className="container">
      <div className="row section" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{bundle.project.name}</h2>
        <span className="muted">{bundle.project.sourceLanguage} → {bundle.project.targetLanguage}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className={tab === 'materials' ? 'primary' : ''} onClick={() => setTab('materials')}>① 素材/术语/阶段</button>
        <button className={tab === 'record' ? 'primary' : ''} onClick={() => setTab('record')}>② 学员录音</button>
        <button className={tab === 'review' ? 'primary' : ''} onClick={() => setTab('review')}>③ 时间轴复盘</button>
        <button onClick={() => setExportOpen(true)}>🔒 加密打包</button>
      </div>

      {salvaged && <div className="banner">{salvaged}</div>}

      {tab === 'materials' && (
        <MaterialsTab bundle={bundle} onAssetAdded={addAsset} onChanged={refresh} />
      )}
      {tab === 'record' && (
        <RecordTab
          project={bundle.project}
          assets={recordingAssets}
          onChanged={refresh}
          onSalvaged={(msg) => setSalvaged(msg)}
        />
      )}
      {tab === 'review' && (
        <ReviewTab bundle={bundle} onAssetUpdate={updateAsset} onChanged={refresh} />
      )}

      {exportOpen && (
        <ExportPackModal
          bundle={bundle}
          onClose={() => setExportOpen(false)}
          onExported={async () => { await touch(projectId); await refresh() }}
        />
      )}
    </div>
  )
}

async function touch(projectId: string): Promise<void> {
  const p = await db.projects.get(projectId)
  if (p) { p.updatedAt = Date.now(); await db.projects.put(p) }
}
