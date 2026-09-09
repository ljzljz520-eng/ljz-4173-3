import { useState } from 'react'
import { db, upsertBundle } from '../db'
import type { PackageManifest, Project } from '../../../shared/types'

export function ImportPackageModal({
  onClose,
  onConflict
}: {
  onClose: () => void
  onConflict: (projectId: string) => Promise<boolean>
}) {
  const [pass, setPass] = useState('')
  const [file, setFile] = useState<string | null>(null)
  const [preview, setPreview] = useState<PackageManifest | null>(null)
  const [error, setError] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  async function choose() {
    const p = await window.trainer.dialog.openPackage()
    if (p) { setFile(p); setPreview(null); setError('') }
  }

  async function peek() {
    if (!file || !pass) return
    setError('')
    try {
      const { manifest } = await window.trainer.packageIO.importEncrypted(file, pass)
      setPreview(manifest)
    } catch (e) { setPreview(null); setError((e as Error).message) }
  }

  async function commit() {
    if (!file || !pass) return
    try {
      const { manifest } = await window.trainer.packageIO.importEncrypted(file, pass)
      const conflict = await onConflict(manifest.project.id)
      if (conflict && !overwrite) {
        setError('工程已存在：勾选"覆盖现有工程索引"后再导入。')
        setPreview(manifest)
        return
      }
      await upsertBundle({
        project: manifest.project as Project,
        assets: manifest.assets,
        terms: manifest.terms,
        markers: manifest.markers,
        recordings: manifest.recordings,
        annotations: manifest.annotations,
        candidates: manifest.candidates
      })
      onClose()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3>导入加密工程包（.sipkg）</h3>
        <div className="form-grid">
          <label>工程包</label>
          <div className="row"><input style={{ flex: 1 }} readOnly value={file ?? ''} placeholder="未选择" />
            <button onClick={choose}>选择…</button></div>
          <label>口令</label>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="解密口令（AES-256-GCM）" />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={peek} disabled={!file || !pass}>校验并预览</button>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            覆盖现有工程索引
          </label>
        </div>
        {preview && (
          <div style={{ marginTop: 10 }} className="panel-box">
            <div><b>{preview.project.name}</b></div>
            <div className="muted">
              素材 {preview.assets.length} · 术语 {preview.terms.length} · 标记 {preview.markers.length} ·
              录音 {preview.recordings.length} · 批注 {preview.annotations.length} · 候选 {preview.candidates.length}
            </div>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!file || !pass} onClick={commit}>解密并导入</button>
        </div>
      </div>
    </div>
  )
}

void db
