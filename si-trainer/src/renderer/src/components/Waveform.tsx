import { useEffect, useMemo, useRef, useState } from 'react'
import { computePeaks } from '../../../shared/analysis'
import type { Annotation, Candidate, StageMarker } from '../../../shared/types'
import { formatClock } from '../../../shared/time'

export interface WaveTrack {
  id: string
  label: string
  color: string
  mono: Float32Array
  durationSec: number
  offsetSec: number
  muted: boolean
}

interface Props {
  tracks: WaveTrack[]
  durationSec: number
  timeSec: number
  selection: { startSec: number; endSec: number } | null
  markers: StageMarker[]
  annotations: Annotation[]
  candidates: Candidate[]
  onSeek: (sec: number) => void
  onSelect: (startSec: number, endSec: number) => void
  onOffsetChange: (trackId: string, offsetSec: number) => void
}

const ROW_H = 64

export function Waveform(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const [width, setWidth] = useState(1000)
  const dragRef = useRef<{ startX: number; moved: boolean } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const timeToX = (t: number) => (t / Math.max(0.001, props.durationSec)) * width
  const xToTime = (x: number) => (x / Math.max(1, width)) * props.durationSec

  const peaksByTrack = useMemo(
    () => props.tracks.map((t) => ({ id: t.id, peaks: computePeaks(t.mono, Math.max(200, width)) })),
    [props.tracks, width]
  )

  useEffect(() => {
    for (const tr of props.tracks) {
      const cv = canvasRefs.current.get(tr.id)
      if (!cv) continue
      const dpr = window.devicePixelRatio || 1
      cv.width = width * dpr
      cv.height = ROW_H * dpr
      const ctx = cv.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, ROW_H)
      ctx.fillStyle = '#0c1017'
      ctx.fillRect(0, 0, width, ROW_H)
      const peaks = peaksByTrack.find((p) => p.id === tr.id)?.peaks
      if (peaks) {
        const offX = timeToX(tr.offsetSec)
        ctx.strokeStyle = tr.muted ? '#46506a' : tr.color
        ctx.globalAlpha = tr.muted ? 0.45 : 0.9
        ctx.beginPath()
        const mid = ROW_H / 2
        for (let x = 0; x < width; x++) {
          const p = peaks.max[x] ?? 0
          const n = peaks.min[x] ?? 0
          ctx.moveTo(x + offX, mid - n * (mid - 3))
          ctx.lineTo(x + offX, mid - p * (mid - 3))
        }
        ctx.stroke()
        ctx.globalAlpha = 1
        // 偏移起点线
        if (tr.offsetSec > 0) {
          ctx.strokeStyle = '#5a6784'
          ctx.setLineDash([4, 3])
          ctx.beginPath(); ctx.moveTo(offX, 0); ctx.lineTo(offX, ROW_H); ctx.stroke()
          ctx.setLineDash([])
        }
      }
      // 叠加批注（限定该轨或源语轨）
      for (const a of props.annotations) {
        if (a.trackAssetId && a.trackAssetId !== tr.id) continue
        const x = timeToX(a.startSec); const w = Math.max(2, timeToX(a.endSec) - x)
        ctx.fillStyle = a.ownerRole === 'teacher' ? 'rgba(78,161,255,.22)' : 'rgba(55,194,139,.22)'
        ctx.fillRect(x, 0, w, ROW_H)
      }
      // 叠加候选
      for (const c of props.candidates) {
        if (c.dismissed || c.accepted) continue
        const x = timeToX(c.startSec); const w = Math.max(2, timeToX(c.endSec) - x)
        ctx.fillStyle = c.type === 'whisper_gap' ? 'rgba(240,169,75,.20)' : 'rgba(181,140,255,.18)'
        ctx.fillRect(x, 0, w, ROW_H)
      }
    }
  }, [props.tracks, props.annotations, props.candidates, peaksByTrack, width, props.durationSec, props.markers])

  function pointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = { startX: e.clientX - rect.left, moved: false }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  function pointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current.moved = true
    const x1 = dragRef.current.startX
    const x2 = e.clientX - rect.left
    props.onSelect(Math.max(0, xToTime(Math.min(x1, x2))), Math.min(props.durationSec, xToTime(Math.max(x1, x2))))
  }
  function pointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (!dragRef.current?.moved) props.onSeek(xToTime(x))
    dragRef.current = null
  }

  const playX = timeToX(props.timeSec)

  return (
    <div ref={wrapRef} className="timeline-wrap">
      {/* 时间刻度 */}
      <div style={{ marginLeft: 138, position: 'relative', height: 18 }}>
        {Array.from({ length: 11 }, (_, i) => {
          const t = (i / 10) * props.durationSec
          return (
            <span key={i} style={{ position: 'absolute', left: `${i * 10}%`, fontSize: 10, color: 'var(--muted)' }}>
              {formatClock(t)}
            </span>
          )
        })}
      </div>
      {props.tracks.map((tr) => (
        <div className="track-row" key={tr.id}>
          <div className="track-label" title={tr.label}>
            <span style={{ color: tr.color }}>●</span> {tr.label}
          </div>
          <div className="canvas-wrap">
            <canvas
              ref={(el) => { if (el) canvasRefs.current.set(tr.id, el); else canvasRefs.current.delete(tr.id) }}
              style={{ height: ROW_H }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
            />
          </div>
        </div>
      ))}
      {/* 播放头与阶段标记覆盖层 */}
      <div className="track-row">
        <div className="track-label muted">阶段/播放头</div>
        <div className="canvas-wrap" style={{ position: 'relative', height: 22, background: '#0c1017', borderRadius: 4 }}>
          {props.markers.map((m) => (
            <div key={m.id} title={`${formatClock(m.timeSec)} ${m.label}${m.note ? ' — ' + m.note : ''}`}
              style={{ position: 'absolute', left: timeToX(m.timeSec), top: 0, bottom: 0, width: 2, background: 'var(--warn)' }} />
          ))}
          <div style={{ position: 'absolute', left: playX, top: 0, bottom: 0, width: 2, background: '#fff' }} />
        </div>
      </div>
      <div className="row" style={{ margin: '8px 0 0 138px' }}>
        <span className="muted">点击=定位，拖拽=选择片段；</span>
        {props.selection && (
          <span className="pill">
            已选 {formatClock(props.selection.startSec)} → {formatClock(props.selection.endSec)}
            （{(props.selection.endSec - props.selection.startSec).toFixed(2)}s）
          </span>
        )}
      </div>
      <TrackOffsetControls tracks={props.tracks} onOffsetChange={props.onOffsetChange} duration={props.durationSec} />
    </div>
  )
}

function TrackOffsetControls({ tracks, onOffsetChange, duration }: {
  tracks: WaveTrack[]
  onOffsetChange: (id: string, v: number) => void
  duration: number
}) {
  return (
    <div style={{ marginLeft: 138, marginTop: 8 }} className="row">
      {tracks.map((t) => (
        <label key={t.id} className="pill row" style={{ gap: 4, marginRight: 12 }}>
          {t.label} 偏移
          <input type="number" step="0.02" min={-duration} max={duration} value={t.offsetSec.toFixed(3)}
            style={{ width: 80 }}
            onChange={(e) => onOffsetChange(t.id, Number(e.target.value))} />
          秒
        </label>
      ))}
    </div>
  )
}
