import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, type FullProjectBundle } from '../db'
import type {
  MediaAsset, Annotation, Candidate, AnnotationCategory
} from '../../../shared/types'
import { AudioEngine } from '../audio/engine'
import { Waveform, type WaveTrack } from '../components/Waveform'
import { findWhisperCandidates } from '../../../shared/analysis'
import { estimateDrift } from '../../../shared/drift'
import { mixToMono } from '../../../shared/wav'
import { formatClock, uid } from '../../../shared/time'
import {
  addReply, canEditBody, createAnnotation, editBody
} from '../../../shared/annotations'
import { findTermHits } from '../../../shared/terms'
import { useRole } from '../App'
import { AnnotationPanel } from '../components/AnnotationPanel'
import { CandidatePanel } from '../components/CandidatePanel'

interface LoadedTrack {
  asset: MediaAsset
  buffer: AudioBuffer
  mono: Float32Array
}

const COLORS: Record<string, string> = {
  speech: 'var(--speech)', student: 'var(--student)', reference: 'var(--ref)', aux: '#8fa3c8'
}

export function ReviewTab({
  bundle, onAssetUpdate, onChanged
}: {
  bundle: FullProjectBundle
  onAssetUpdate: (a: MediaAsset) => Promise<void>
  onChanged: () => Promise<void>
}) {
  const role = useRole().role
  const engineRef = useRef<AudioEngine | null>(null)
  const [tracks, setTracks] = useState<LoadedTrack[]>([])
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [state, setState] = useState<{ playing: boolean; timeSec: number; durationSec: number }>({
    playing: false, timeSec: 0, durationSec: 0
  })
  const [selection, setSelection] = useState<{ startSec: number; endSec: number } | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>(bundle.annotations)
  const [candidates, setCandidates] = useState<Candidate[]>(bundle.candidates)
  const [busy, setBusy] = useState('')
  const [driftInfo, setDriftInfo] = useState('')
  const [selectedTrackId, setSelectedTrackId] = useState<string | undefined>(undefined)
  const transcriptRef = useRef<HTMLTextAreaElement>(null)

  // 初始化引擎 & 载入轨道
  useEffect(() => {
    const engine = new AudioEngine()
    engineRef.current = engine
    const off = engine.onTick((s) => setState(s))
    return () => { off(); engine.dispose(); engineRef.current = null }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const engine = engineRef.current
      if (!engine) return
      setBusy('解码音频（本机 Web Audio）…')
      const loaded: LoadedTrack[] = []
      const offs: Record<string, number> = {}
      for (const a of bundle.assets) {
        try {
          const bytes = await window.trainer.media.readWavBytes(a.wavRelPath)
          const buffer = await engine.decode(bytes)
          const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
          const mono = mixToMono(chans as Float32Array[])
          loaded.push({ asset: a, buffer, mono })
          offs[a.id] = a.trackOffsetSec ?? 0
        } catch (e) {
          console.error('载入失败', a.id, e)
        }
      }
      if (cancelled) return
      for (const lt of loaded) {
        engine.addTrack({
          id: lt.asset.id,
          label: lt.asset.label,
          buffer: lt.buffer,
          offsetSec: offs[lt.asset.id],
          gain: 1,
          muted: false,
          color: getColor(lt.asset)
        })
      }
      setTracks(loaded)
      setOffsets(offs)
      setSelectedTrackId(loaded.find((t) => t.asset.kind === 'student')?.asset.id ?? loaded[0]?.asset.id)
      setBusy('')
    }
    void load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.assets.map((a) => a.id + ':' + a.wavRelPath).join('|')])

  const durationSec = useMemo(() => {
    let d = 0
    for (const t of tracks) d = Math.max(d, (offsets[t.asset.id] ?? 0) + t.buffer.duration)
    return d
  }, [tracks, offsets])

  const waveTracks: WaveTrack[] = useMemo(() => tracks.map((t) => ({
    id: t.asset.id,
    label: `${t.asset.label}${t.asset.channels > 1 ? ` (${t.asset.channels}ch)` : ''}`,
    color: getColor(t.asset),
    mono: t.mono,
    durationSec: t.buffer.duration,
    offsetSec: offsets[t.asset.id] ?? 0,
    muted: Boolean(muted[t.asset.id])
  })), [tracks, offsets, muted])

  const play = useCallback(async () => {
    const e = engineRef.current; if (!e) return
    await e.resume()
    e.play()
  }, [])
  const pause = useCallback(() => engineRef.current?.pause(), [])
  const seek = useCallback((sec: number) => engineRef.current?.seek(sec), [])

  const changeOffset = useCallback(async (trackId: string, v: number) => {
    setOffsets((o) => ({ ...o, [trackId]: v }))
    engineRef.current?.updateTrack(trackId, { offsetSec: v })
    const asset = bundle.assets.find((a) => a.id === trackId)
    if (asset) { asset.trackOffsetSec = v; await onAssetUpdate(asset) }
  }, [bundle.assets, onAssetUpdate])

  function toggleMute(id: string) {
    const next = !muted[id]
    setMuted((m) => ({ ...m, [id]: next }))
    engineRef.current?.updateTrack(id, { muted: next })
  }

  // ===== 自动分析（仅候选，不自动生成批注） =====
  async function computeWhisper() {
    const lt = tracks.find((t) => t.asset.id === selectedTrackId) ?? tracks.find((t) => t.asset.kind === 'student')
    if (!lt) return alert('请先导入或录制学员声道')
    setBusy('计算耳语间隔候选…')
    try {
      const found = findWhisperCandidates(lt.mono, { sampleRate: lt.buffer.sampleRate })
      const rows: Candidate[] = found.map((f) => {
        const off = offsets[lt.asset.id] ?? 0
        return {
          id: uid(), projectId: bundle.project.id, type: 'whisper_gap',
          startSec: Math.max(0, f.startSec + off), endSec: f.endSec + off,
          score: f.score, reason: `${f.reason}（能量≈噪声底×${f.levelRatio.toFixed(1)}，置信度 ${f.score}）`,
          accepted: false, dismissed: false, createdAt: Date.now()
        }
      })
      await db.candidates.bulkAdd(rows)
      setCandidates((c) => [...c, ...rows])
      setDriftInfo(`耳语候选 ${rows.length} 个，全部待教员确认（自动结果仅辅助定位）`)
      await onChanged()
    } finally { setBusy('') }
  }

  async function computeDrift() {
    const src = tracks.find((t) => t.asset.kind === 'speech')
    const stu = tracks.find((t) => t.asset.kind === 'student')
    if (!src || !stu) return alert('需要原语音与至少一条学员声道')
    setBusy('双声道能量包络互相关分析…')
    try {
      const rate = Math.min(src.buffer.sampleRate, stu.buffer.sampleRate)
      const r = estimateDrift(src.mono, stu.mono, rate, 5)
      if (r.confidence < 0.05) { setDriftInfo('漂移相关峰不明显（置信度低），建议人工对齐'); return }
      // delaySec>0：学员轨落后 -> 学员轨 offset 应减少（在时间轴上前移）
      const cur = offsets[stu.asset.id] ?? 0
      const next = Math.round((cur - r.delaySec) * 1000) / 1000
      setDriftInfo(`检测到学员轨滞后 ${r.delaySec.toFixed(3)}s（相关系数 ${r.confidence}），建议偏移 ${next.toFixed(3)}s；点击"应用"`)
      window.__driftSuggestion = { assetId: stu.asset.id, value: next, raw: r }
    } finally { setBusy('') }
  }

  async function applyDrift() {
    const s = window.__driftSuggestion
    if (!s) return
    await changeOffset(s.assetId, s.value)
    setDriftInfo(`已应用偏移 ${s.value}s（自动结果可在波形下方手动微调）`)
  }

  /** 阶段标记 → 定位候选（固定宽窗口，教员确认后成为批注） */
  async function phaseCandidates() {
    if (!bundle.markers.length) return alert('请先在素材页添加阶段标记')
    const rows: Candidate[] = bundle.markers.map((m) => ({
      id: uid(), projectId: bundle.project.id, type: 'phase',
      startSec: Math.max(0, m.timeSec - 0.5), endSec: m.timeSec + 1.5,
      score: 1, reason: `阶段标记「${m.label}」@${m.timeSec.toFixed(2)}s${m.note ? '：' + m.note : ''}`,
      accepted: false, dismissed: false, createdAt: Date.now()
    }))
    await db.candidates.bulkAdd(rows)
    setCandidates((c) => [...c, ...rows])
    setDriftInfo(`已生成 ${rows.length} 个阶段定位候选`)
  }

  async function scanTerms() {    const text = transcriptRef.current?.value ?? ''
    if (!text.trim()) return alert('请先粘贴学员译音转写文本')
    const hits = findTermHits(text, bundle.terms)
    if (!hits.length) { setDriftInfo('未命中术语') ; return }
    // 字符偏移无法直接映射到音频时间：作为时间未知候选，教员在时间轴上定位
    const rows: Candidate[] = hits.map((h) => ({
      id: uid(), projectId: bundle.project.id, type: 'term_hit',
      startSec: 0, endSec: 0, score: h.homograph ? 0.6 : 0.9,
      reason: `术语命中「${h.surface}」→ ${h.target}${h.homograph ? '；同形异义，须选择义项' : ''}`,
      senseId: h.senseId, surface: h.surface,
      accepted: false, dismissed: false, createdAt: Date.now()
    }))
    await db.candidates.bulkAdd(rows)
    setCandidates((c) => [...c, ...rows])
    setDriftInfo(`术语候选 ${rows.length} 个（文本定位，需人工落到时间轴）`)
    await onChanged()
  }

  // ===== 批注操作（权限规则来自 shared/annotations） =====
  const persistAnnotation = useCallback(async (a: Annotation) => {
    await db.annotations.put(a)
    setAnnotations((arr) => arr.map((x) => x.id === a.id ? a : x))
    await onChanged()
  }, [onChanged])

  const addAnnotation = useCallback(async (category: AnnotationCategory, text: string) => {
    if (!selection) return alert('请先在时间轴拖拽选择片段')
    const a = createAnnotation({
      projectId: bundle.project.id,
      trackAssetId: selectedTrackId,
      startSec: selection.startSec,
      endSec: selection.endSec,
      category, text, authorRole: role
    })
    await db.annotations.add(a)
    setAnnotations((arr) => [...arr, a])
    await onChanged()
  }, [selection, selectedTrackId, role, bundle.project.id, onChanged])

  const replyAnnotation = useCallback(async (id: string, text: string) => {
    const cur = bundle.annotations.find((x) => x.id === id) ?? annotations.find((x) => x.id === id)
    if (!cur) return
    const next = addReply(cur, role, text)
    await persistAnnotation(next)
  }, [annotations, bundle.annotations, role, persistAnnotation])

  const editAnnotation = useCallback(async (id: string, text: string, category: AnnotationCategory) => {
    const cur = annotations.find((x) => x.id === id)
    if (!cur) return
    const next = editBody(cur, role, { text, category })
    await persistAnnotation(next)
  }, [annotations, role, persistAnnotation])

  // 接受候选 -> 生成批注（自动结果始终需要人工确认）
  const acceptCandidate = useCallback(async (c: Candidate, patch: {
    startSec?: number; endSec?: number; category: AnnotationCategory; text: string; senseId?: string
  }) => {
    const startSec = patch.startSec ?? c.startSec
    const endSec = patch.endSec ?? (c.endSec > c.startSec ? c.endSec : startSec + 0.5)
    const a = createAnnotation({
      projectId: bundle.project.id,
      trackAssetId: selectedTrackId,
      startSec, endSec,
      category: patch.category,
      text: patch.text,
      authorRole: role
    })
    const accepted: Candidate = {
      ...c, accepted: true, dismissed: false,
      startSec, endSec, senseId: patch.senseId ?? c.senseId,
      annotationId: a.id
    }
    await db.annotations.add(a)
    await db.candidates.put(accepted)
    setAnnotations((arr) => [...arr, a])
    setCandidates((cs) => cs.map((x) => x.id === c.id ? accepted : x))
    await onChanged()
  }, [bundle.project.id, role, selectedTrackId, onChanged])

  const dismissCandidate = useCallback(async (c: Candidate) => {
    const next = { ...c, dismissed: !c.dismissed }
    await db.candidates.put(next)
    setCandidates((cs) => cs.map((x) => x.id === c.id ? next : x))
  }, [])

  if (tracks.length === 0 && !busy) {
    return <div className="panel-box muted">没有可复盘的音频。请先在素材页导入讲话音频，或在录音页录制学员声道。</div>
  }

  return (
    <div>
      {busy && <div className="banner">{busy}</div>}
      {driftInfo && <div className="banner">{driftInfo}{window.__driftSuggestion &&
        <button style={{ marginLeft: 10 }} onClick={applyDrift}>应用漂移建议</button>}</div>}

      <div className="panel-box transport">
        {state.playing
          ? <button className="primary" onClick={pause}>⏸ 暂停</button>
          : <button className="primary" onClick={play}>▶ 播放</button>}
        <button onClick={() => seek(0)}>⏮ 归零</button>
        <span className="time-readout">{formatClock(state.timeSec)} / {formatClock(durationSec)}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="muted">分析（仅生成候选，不自动下结论）：</span>
        <button onClick={computeWhisper}>耳语间隔候选</button>
        <button onClick={computeDrift}>双声道漂移</button>
        <button onClick={phaseCandidates}>阶段标记定位</button>
        <select value={selectedTrackId ?? ''} onChange={(e) => setSelectedTrackId(e.target.value || undefined)}
          style={{ width: 180 }}>
          {tracks.map((t) => <option key={t.asset.id} value={t.asset.id}>{t.asset.label}</option>)}
        </select>
      </div>

      <div style={{ marginTop: 10 }}>
        <Waveform
          tracks={waveTracks}
          durationSec={durationSec}
          timeSec={state.timeSec}
          selection={selection}
          markers={bundle.markers}
          annotations={annotations}
          candidates={candidates}
          onSeek={seek}
          onSelect={(s, e2) => setSelection({ startSec: s, endSec: e2 })}
          onOffsetChange={changeOffset}
        />
        <div className="row" style={{ marginTop: 6, marginLeft: 138 }}>
          {tracks.map((t) => (
            <button key={t.asset.id} onClick={() => toggleMute(t.asset.id)}>
              {muted[t.asset.id] ? '🔇' : '🔊'} {t.asset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="side">
        <AnnotationPanel
          role={role}
          selection={selection}
          annotations={annotations}
          activeAt={state.timeSec}
          onAdd={addAnnotation}
          onReply={replyAnnotation}
          onEdit={editAnnotation}
          canEditBody={canEditBody}
          onSeek={seek}
          transcriptSlot={
            <div className="panel-box" style={{ marginBottom: 10 }}>
              <h2>学员译音转写（术语扫描用）</h2>
              <textarea ref={transcriptRef} rows={3} style={{ width: '100%' }}
                placeholder="粘贴学员译音文本，用于术语同形异义候选定位…" />
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={scanTerms}>扫描术语命中</button>
                {bundle.terms.some((t) => t.homograph) &&
                  <span className="tag warn">含同形异义词，命中须人工选定义项</span>}
              </div>
            </div>
          }
        />
        <CandidatePanel
          candidates={candidates}
          terms={bundle.terms}
          selection={selection}
          role={role}
          onSeek={seek}
          onAccept={acceptCandidate}
          onDismiss={dismissCandidate}
        />
      </div>
    </div>
  )
}

function getColor(a: MediaAsset): string {
  return COLORS[a.kind] ?? COLORS.aux
}

declare global {
  interface Window {
    __driftSuggestion?: { assetId: string; value: number; raw: { delaySec: number; confidence: number } }
  }
}
