import { useRef, useState } from 'react'
import { db } from '../db'
import type { FullProjectBundle } from '../db'
import type { MediaAsset, StageMarker, TermEntry } from '../../../shared/types'
import { uid, formatClock } from '../../../shared/time'
import { parseTermsCsv } from '../../../shared/terms'

export function MaterialsTab({
  bundle, onAssetAdded, onChanged
}: {
  bundle: FullProjectBundle
  onAssetAdded: (a: MediaAsset) => void
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileTerms = useRef<HTMLInputElement>(null)

  async function importAudio(kind: 'speech' | 'reference', label: string, channels: 1 | 2) {
    setError(''); setBusy(`正在导入${label}…`)
    try {
      const picked = await window.trainer.dialog.openAudio()
      if (!picked) return
      const assetId = uid()
      const meta = await window.trainer.media.importAudio(picked.path, {
        projectId: bundle.project.id, kind, label, assetId, channels
      })
      const asset: MediaAsset = {
        id: assetId,
        projectId: bundle.project.id,
        kind,
        label,
        originalName: picked.name,
        relPath: meta.relPath,
        wavRelPath: meta.wavRelPath,
        sha256: meta.sha256,
        sizeBytes: meta.sizeBytes,
        sampleRate: meta.sampleRate,
        channels: meta.channels,
        durationSec: meta.durationSec,
        sourceSampleRate: meta.sourceSampleRate,
        trackOffsetSec: 0,
        createdAt: Date.now()
      }
      await onAssetAdded(asset)
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy('') }
  }

  async function importTermsCsv(file: File) {
    setError('')
    try {
      const text = await file.text()
      const terms: TermEntry[] = parseTermsCsv(text, bundle.project.id)
      if (!terms.length) { setError('CSV 无有效行（需要表头含 surface,target）'); return }
      await db.terms.bulkAdd(terms)
      await onChanged()
    } catch (e) { setError((e as Error).message) }
  }

  async function addMarker(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const time = Number(fd.get('time'))
    const label = String(fd.get('label') ?? '').trim()
    if (!Number.isFinite(time) || !label) return
    const m: StageMarker = {
      id: uid(), projectId: bundle.project.id, timeSec: time, label,
      note: String(fd.get('note') ?? '').trim() || undefined, createdAt: Date.now()
    }
    await db.markers.add(m)
    e.currentTarget.reset()
    await onChanged()
  }

  const speech = bundle.assets.filter((a) => a.kind === 'speech')
  const refs = bundle.assets.filter((a) => a.kind === 'reference')
  const mismatchAssets = bundle.assets.filter(
    (a) => a.sourceSampleRate && a.sourceSampleRate !== a.sampleRate
  )

  return (
    <div>
      {busy && <div className="banner">{busy}</div>}
      {error && <div className="banner" style={{ borderColor: 'var(--danger)', color: '#ffc7c7' }}>{error}</div>}
      {mismatchAssets.length > 0 && (
        <div className="banner">
          采样率不一致：{mismatchAssets.map((a) =>
            `${a.label} 源 ${a.sourceSampleRate}Hz → 统一 ${a.sampleRate}Hz`).join('；')}。
          复盘时请以统一时间轴为准核对音素对齐。
        </div>
      )}

      <div className="two-col">
        <div className="panel-box section">
          <h2>讲话音频（原语音）</h2>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => importAudio('speech', `原语音 ${speech.length + 1}`, 1)}>
              导入讲话音频（自动转 48k WAV）
            </button>
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>名称</th><th>时长</th><th>采样率</th><th>SHA-256</th></tr></thead>
            <tbody>
              {speech.map((a) => (
                <tr key={a.id}>
                  <td>{a.label}<div className="pill">{a.originalName}</div></td>
                  <td>{formatClock(a.durationSec)}</td>
                  <td>{a.sampleRate}Hz{a.sourceSampleRate && a.sourceSampleRate !== a.sampleRate &&
                    <span className="tag danger">源 {a.sourceSampleRate}</span>}</td>
                  <td className="pill">{a.sha256.slice(0, 12)}…</td>
                </tr>
              ))}
              {speech.length === 0 && <tr><td colSpan={4} className="muted">未导入</td></tr>}
            </tbody>
          </table>

          <h2 style={{ marginTop: 18 }}>参考音频（选填）</h2>
          <button onClick={() => importAudio('reference', `参考音频 ${refs.length + 1}`, 1)}>导入参考音频</button>
          {refs.map((a) => <div key={a.id} className="pill" style={{ marginTop: 6 }}>
            <span className="tag reference">参考</span> {a.label} · {formatClock(a.durationSec)}
          </div>)}
        </div>

        <div className="panel-box section">
          <h2>参考术语（CSV：surface,target,senseId,senseNote,note）</h2>
          <input ref={fileTerms} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importTermsCsv(f); e.target.value = '' }} />
          <button className="primary" onClick={() => fileTerms.current?.click()}>导入术语 CSV</button>
          <p className="muted" style={{ marginTop: 6 }}>
            同一 surface 若出现多个 senseId / 译文，自动标记为同形异义词；复盘时命中仅作候选，义项须人工确认。
          </p>
          <table>
            <thead><tr><th>原形</th><th>译文</th><th>义项</th><th></th></tr></thead>
            <tbody>
              {bundle.terms.map((t) => (
                <tr key={t.id}>
                  <td>{t.surface}</td>
                  <td>{t.target}</td>
                  <td>{t.senseId ? <span className="tag warn">{t.senseId}</span> : <span className="muted">—</span>}
                    {t.senseNote && <div className="pill">{t.senseNote}</div>}</td>
                  <td>{t.homograph && <span className="tag warn">同形异义</span>}</td>
                </tr>
              ))}
              {bundle.terms.length === 0 && <tr><td colSpan={4} className="muted">未导入</td></tr>}
            </tbody>
          </table>

          <h2 style={{ marginTop: 18 }}>阶段标记</h2>
          <form className="row" onSubmit={addMarker}>
            <input name="time" type="number" step="0.001" min="0" placeholder="时间(秒)" style={{ width: 100 }} required />
            <input name="label" placeholder="阶段名称（如：数字密集段）" style={{ width: 180 }} required />
            <input name="note" placeholder="备注" style={{ width: 140 }} />
            <button className="primary" type="submit">添加标记</button>
          </form>
          <div style={{ marginTop: 8 }}>
            {bundle.markers.map((m) => (
              <span className="marker-chip" key={m.id} title={m.note}>
                {formatClock(m.timeSec)} {m.label}
                <button style={{ marginLeft: 6, padding: '0 6px' }}
                  onClick={async () => { await db.markers.delete(m.id); await onChanged() }}>×</button>
              </span>
            ))}
            {bundle.markers.length === 0 && <span className="muted">无标记</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
