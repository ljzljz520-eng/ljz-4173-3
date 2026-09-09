import { useState } from 'react'
import type { FullProjectBundle } from '../db'
import type { PackageManifest } from '../../../shared/types'

export function ExportPackModal({
  bundle, onClose, onExported
}: {
  bundle: FullProjectBundle
  onClose: () => void
  onExported: () => Promise<void>
}) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function doExport() {
    setErr(''); setMsg('')
    if (pass.length < 6) { setErr('口令至少 6 个字符'); return }
    if (pass !== pass2) { setErr('两次口令不一致'); return }
    setBusy(true)
    try {
      // files: 逻辑键 -> 包内相对路径（即媒体目录相对路径）
      const files: Record<string, string> = {}
      for (const a of bundle.assets) {
        files[`orig:${a.id}`] = a.relPath
        files[`wav:${a.id}`] = a.wavRelPath
      }
      const manifest: PackageManifest = {
        version: 1,
        project: bundle.project,
        assets: bundle.assets,
        terms: bundle.terms,
        markers: bundle.markers,
        recordings: bundle.recordings,
        annotations: bundle.annotations,
        candidates: bundle.candidates,
        files,
        exportedAt: Date.now()
      }
      const safeName = bundle.project.name.replace(/[\\/:*?"<>|]/g, '_')
      const out = await window.trainer.dialog.savePackage(`${safeName}.sipkg`)
      if (!out) { setBusy(false); return }
      const r = await window.trainer.packageIO.exportEncrypted(out, manifest, pass)
      setMsg(`已导出：${r.fileCount} 个媒体文件，${(r.bytes / 1024 / 1024).toFixed(2)} MB（AES-256-GCM，全程本机处理）`)
      await onExported()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>加密打包工程</h3>
        <p className="muted">
          索引（Dexie 元数据、批注、候选）与本机音频字节一并打包，scrypt 派生密钥 + AES-256-GCM 加密并防篡改。
          录音与转码文件不会在任何步骤离开本机。
        </p>
        <div className="form-grid">
          <label>口令</label>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="至少 6 个字符" />
          <label>确认口令</label>
          <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
        </div>
        <ul className="muted" style={{ fontSize: 12 }}>
          <li>素材 {bundle.assets.length} · 术语 {bundle.terms.length} · 阶段 {bundle.markers.length}</li>
          <li>录音会话 {bundle.recordings.length}（含意外终止标记）· 批注 {bundle.annotations.length} · 候选 {bundle.candidates.length}</li>
        </ul>
        {err && <p className="error-text">{err}</p>}
        {msg && <p className="ok-text">{msg}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={busy} onClick={doExport}>{busy ? '加密中…' : '选择位置并导出'}</button>
        </div>
      </div>
    </div>
  )
}
