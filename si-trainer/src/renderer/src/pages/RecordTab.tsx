import { useEffect, useRef, useState } from 'react'
import { db } from '../db'
import type { MediaAsset, Project, RecordingSession } from '../../../shared/types'
import { Recorder } from '../audio/recorder'
import { uid, formatClock } from '../../../shared/time'

interface DeviceItem { deviceId: string; label: string }

export function RecordTab({
  project, assets, onChanged, onSalvaged
}: {
  project: Project
  assets: MediaAsset[]
  onChanged: () => Promise<void>
  onSalvaged: (msg: string) => void
}) {
  const [devices, setDevices] = useState<DeviceItem[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [label, setLabel] = useState('')
  const [recording, setRecording] = useState<Recorder | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState<'unknown' | 'ok' | 'denied'>('unknown')
  const [orphans, setOrphans] = useState<RecordingSession[]>([])
  const recRef = useRef<Recorder | null>(null)

  // 启动/崩溃后遗留：会话存在但无 assetId，且磁盘上有 .part
  async function detectOrphans() {
    const sessions = await db.recordings
      .where('projectId').equals(project.id)
      .filter((s) => !s.endedAt || !s.assetId)
      .toArray()
    const found: RecordingSession[] = []
    for (const s of sessions) {
      const st = await window.trainer.recording.partExists(s.id)
      if (st.exists) found.push(s)
    }
    setOrphans(found)
  }
  useEffect(() => { void detectOrphans() }, [project.id])

  async function recoverOrphan(s: RecordingSession) {
    try {
      const r = await window.trainer.recording.salvage(s.id)
      const assetId = uid()
      const rel = `recordings/${s.id}.wav`
      const asset: MediaAsset = {
        id: assetId, projectId: project.id, kind: 'student', label: s.label,
        originalName: `${s.id}.wav`, relPath: rel, wavRelPath: rel,
        sha256: r.sha, sizeBytes: r.size, sampleRate: r.info.sampleRate,
        channels: r.info.channels, durationSec: r.info.durationSec,
        trackOffsetSec: 0, createdAt: Date.now()
      }
      const fixed: RecordingSession = {
        ...s, assetId, endedAt: Date.now(), durationSec: r.info.durationSec,
        sha256: r.sha, sizeBytes: r.size, terminatedAbruptly: true,
        salvageNote: r.note
      }
      await db.assets.put(asset)
      await db.recordings.put(fixed)
      onSalvaged(`已恢复意外终止的录音「${s.label}」：${r.note}`)
      await onChanged()
      await detectOrphans()
    } catch (e) { setError(`恢复失败：${(e as Error).message}`) }
  }

  async function discardOrphan(s: RecordingSession) {
    await window.trainer.recording.abandon(s.id)
    await db.recordings.delete(s.id)
    await detectOrphans()
  }

  async function enumerate(askPermission = false) {
    try {
      if (askPermission) {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        s.getTracks().forEach((t) => t.stop())
        setPermission('ok')
      }
      const list = await navigator.mediaDevices.enumerateDevices()
      const inputs = list
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `麦克风 ${d.deviceId.slice(0, 6)}` }))
      setDevices(inputs)
      if (inputs.length && !deviceId) setDeviceId(inputs[0].deviceId)
      if (!askPermission) setPermission(inputs.some((d) => d.label) ? 'ok' : 'unknown')
    } catch {
      setPermission('denied')
    }
  }
  useEffect(() => { void enumerate(false) }, [])
  useEffect(() => {
    if (!recording) return
    const t = window.setInterval(() => setElapsed(recRef.current?.elapsedSec ?? 0), 250)
    return () => window.clearInterval(t)
  }, [recording])

  async function start() {
    setError('')
    try {
      const dev = devices.find((d) => d.deviceId === deviceId)
      const rec = new Recorder({
        projectId: project.id,
        label: label.trim() || `学员录音 ${assets.length + 1}`,
        deviceId,
        deviceLabel: dev?.label || '默认麦克风',
        onError: (e) => setError(e.message)
      })
      recRef.current = rec
      await rec.start()
      setRecording(rec)
      setElapsed(0)
    } catch (e) {
      setError(`无法开始录音：${(e as Error).message}`)
      setPermission('denied')
    }
  }

  async function stop(abandon = false) {
    const rec = recRef.current
    if (!rec) return
    try {
      if (abandon) {
        await rec.abandon()
      } else {
        const session = await rec.stop()
        // 录音文件已在主进程转为 .wav，登记素材与会话（文件摘要/设备/采样率齐全）
        const assetId = uid()
        const rel = `recordings/${session.id}.wav`
        const asset: MediaAsset = {
          id: assetId,
          projectId: project.id,
          kind: 'student',
          label: session.label,
          originalName: `${session.id}.wav`,
          relPath: rel,
          wavRelPath: rel,
          sha256: session.sha256!,
          sizeBytes: session.sizeBytes!,
          sampleRate: session.sampleRate,
          channels: session.channels,
          durationSec: session.durationSec!,
          trackOffsetSec: 0,
          createdAt: Date.now()
        }
        session.assetId = assetId
        await db.assets.put(asset)
        await db.recordings.put(session)
        if (session.terminatedAbruptly) {
          onSalvaged(`⚠️ 录音意外终止，已自动修复：${session.salvageNote ?? ''}`)
        }
        await onChanged()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRecording(null)
      recRef.current = null
      setElapsed(0)
    }
  }

  return (
    <div>
      {error && <div className="banner" style={{ borderColor: 'var(--danger)', color: '#ffc7c7' }}>{error}</div>}
      <div className="panel-box section">
        <h2>录制学员声道</h2>
        {permission === 'denied' && (
          <div className="banner" style={{ borderColor: 'var(--danger)', color: '#ffc7c7' }}>
            麦克风权限被拒绝，请在系统/浏览器权限中允许后重试。
          </div>
        )}
        {orphans.length > 0 && (
          <div className="banner">
            检测到 {orphans.length} 段因应用退出/断电未正常收尾的录音（.part）：
            {orphans.map((s) => (
              <span key={s.id} className="row" style={{ display: 'inline-flex', marginLeft: 8 }}>
                <b>{s.label}</b>
                <button onClick={() => recoverOrphan(s)}>修复并入库</button>
                <button className="danger" onClick={() => discardOrphan(s)}>丢弃</button>
              </span>
            ))}
          </div>
        )}
        <div className="row">
          <label>输入设备</label>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={!!recording} style={{ width: 320 }}>
            {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          </select>
          <button onClick={() => enumerate(true)}>检测/授权麦克风</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="录音标签（如：学员A 第一轮）" value={label}
            onChange={(e) => setLabel(e.target.value)} disabled={!!recording} style={{ width: 240 }} />
          {!recording ? (
            <button className="primary" disabled={!deviceId} onClick={start}>● 开始录音</button>
          ) : (
            <>
              <span className="time-readout">● {formatClock(elapsed)}</span>
              <button className="primary" onClick={() => stop(false)}>■ 停止并保存</button>
              <button className="danger" onClick={() => stop(true)}>放弃</button>
            </>
          )}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          录音每秒增量写入本机磁盘（16-bit PCM WAV），保存设备、采样率与 SHA-256 摘要；
          应用崩溃/断电后重新进入工程可从截断文件恢复有效音频。
        </p>
      </div>

      <div className="panel-box">
        <h2>本工程学员声道（{assets.length}）</h2>
        <table>
          <thead><tr><th>标签</th><th>设备</th><th>采样率</th><th>时长</th><th>摘要</th><th>状态</th></tr></thead>
          <tbody>
            {assets.map((a) => (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  <td className="pill"><DeviceCell assetId={a.id} /></td>
                  <td>{a.sampleRate}Hz/{a.channels}ch</td>
                  <td>{formatClock(a.durationSec)}</td>
                  <td className="pill">{a.sha256.slice(0, 12)}…</td>
                  <td><SessionLookup assetId={a.id} /></td>
                </tr>
            ))}
            {assets.length === 0 && <tr><td colSpan={6} className="muted">尚未录制</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DeviceCell({ assetId }: { assetId: string }) {
  const [s, setS] = useState<string>('…')
  useEffect(() => {
    let alive = true
    db.recordings.where('assetId').equals(assetId).first().then((r) => {
      if (alive) setS(r ? r.deviceLabel : '—')
    })
    return () => { alive = false }
  }, [assetId])
  return <span title="设备ID + 采样率随会话元数据保存">{s}</span>
}

function SessionLookup({ assetId }: { assetId: string }) {
  const [s, setS] = useState<RecordingSession | null>(null)
  useEffect(() => {
    let alive = true
    db.recordings.where('assetId').equals(assetId).first().then((r) => { if (alive) setS(r ?? null) })
    return () => { alive = false }
  }, [assetId])
  if (!s) return <span className="muted">—</span>
  return s.terminatedAbruptly
    ? <span className="tag danger">意外终止·已修复</span>
    : <span className="tag" style={{ color: 'var(--accent2)' }}>正常</span>
}
