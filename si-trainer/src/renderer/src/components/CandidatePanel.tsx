import { useMemo, useState } from 'react'
import type { AnnotationCategory, Candidate, TermEntry } from '../../../shared/types'
import { formatClock } from '../../../shared/time'
import { catLabel } from './AnnotationPanel'

const TYPE_LABEL: Record<Candidate['type'], string> = {
  whisper_gap: '耳语间隔',
  term_hit: '术语命中',
  drift: '漂移',
  phase: '阶段标记'
}

export function CandidatePanel(props: {
  candidates: Candidate[]
  terms: TermEntry[]
  selection: { startSec: number; endSec: number } | null
  role: 'teacher' | 'student'
  onSeek: (sec: number) => void
  onAccept: (c: Candidate, patch: {
    startSec?: number; endSec?: number; category: AnnotationCategory; text: string; senseId?: string
  }) => Promise<void>
  onDismiss: (c: Candidate) => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | Candidate['type']>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const visible = useMemo(() =>
    props.candidates
      .filter((c) => filter === 'all' || c.type === filter)
      .sort((a, b) => a.startSec - b.startSec),
    [props.candidates, filter])

  return (
    <div className="panel-box">
      <h2>自动分析候选 <span className="pill">（仅辅助定位，须人工确认）</span></h2>
      <div className="row" style={{ marginBottom: 8 }}>
        {(['all', 'whisper_gap', 'term_hit', 'drift', 'phase'] as const).map((t) => (
          <button key={t} className={filter === t ? 'primary' : ''} style={{ padding: '2px 8px' }}
            onClick={() => setFilter(t)}>
            {t === 'all' ? '全部' : TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <div style={{ maxHeight: 520, overflow: 'auto' }}>
        {visible.map((c) => (
          <CandidateRow key={c.id} c={c} terms={props.terms} selection={props.selection}
            role={props.role} open={openId === c.id}
            onToggle={() => setOpenId(openId === c.id ? null : c.id)}
            onSeek={props.onSeek} onAccept={props.onAccept} onDismiss={props.onDismiss} />
        ))}
        {visible.length === 0 && <p className="muted">暂无候选。点击顶部"耳语间隔候选 / 双声道漂移 / 扫描术语命中"生成。</p>}
      </div>
    </div>
  )
}

function CandidateRow(props: {
  c: Candidate
  terms: TermEntry[]
  selection: { startSec: number; endSec: number } | null
  role: 'teacher' | 'student'
  open: boolean
  onToggle: () => void
  onSeek: (sec: number) => void
  onAccept: CandidatePanelProps2
  onDismiss: (c: Candidate) => Promise<void>
}) {
  const { c } = props
  const [category, setCategory] = useState<AnnotationCategory>(
    c.type === 'whisper_gap' ? 'omission' : c.type === 'term_hit' ? 'number_unit' : 'strategy')
  const [senseId, setSenseId] = useState(c.senseId ?? '')
  const [text, setText] = useState(c.reason)
  const [start, setStart] = useState(c.startSec)
  const [end, setEnd] = useState(c.endSec)

  const senses = useMemo(() => {
    if (!c.surface) return []
    return props.terms.filter((t) => t.surface.toLowerCase() === c.surface!.toLowerCase())
  }, [props.terms, c.surface])

  return (
    <div className={`candidate ${c.accepted ? 'accepted' : ''} ${c.dismissed ? 'dismissed' : ''}`}>
      <div className="row">
        <span className="tag warn">{TYPE_LABEL[c.type]}</span>
        <button className="pill" style={{ padding: '0 6px' }}
          onClick={() => props.onSeek(c.startSec)}>
          {c.endSec > c.startSec ? `${formatClock(c.startSec)}–${formatClock(c.endSec)}` : '时间待定'}
        </button>
        <span className="pill">score {c.score}</span>
        <span style={{ flex: 1 }} />
        <button style={{ padding: '2px 8px' }} onClick={props.onToggle}>{props.open ? '收起' : '处理'}</button>
      </div>
      <div className="pill" style={{ marginTop: 4 }}>{c.reason}</div>
      {props.open && !c.accepted && (
        <div style={{ marginTop: 8 }}>
          {c.type === 'term_hit' && senses.length > 1 && (
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="tag danger">同形异义·选择义项</span>
              <select value={senseId} onChange={(e) => setSenseId(e.target.value)}>
                <option value="">（必须选择义项）</option>
                {senses.map((t) => (
                  <option key={t.id} value={t.senseId ?? t.target}>
                    {t.senseId || t.target}{t.senseNote ? ` — ${t.senseNote}` : ''} → {t.target}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="row" style={{ marginBottom: 6 }}>
            <label className="pill">起 <input type="number" step="0.01" value={start} style={{ width: 80 }}
              onChange={(e) => setStart(Number(e.target.value))} /></label>
            <label className="pill">止 <input type="number" step="0.01" value={end} style={{ width: 80 }}
              onChange={(e) => setEnd(Number(e.target.value))} /></label>
            {props.selection && (
              <button style={{ padding: '2px 8px' }} onClick={() => {
                setStart(props.selection!.startSec); setEnd(props.selection!.endSec)
              }}>使用当前选区</button>
            )}
          </div>
          <div className="row" style={{ marginBottom: 6 }}>
            <select value={category} onChange={(e) => setCategory(e.target.value as AnnotationCategory)}>
              {(['omission', 'self_correction', 'number_unit', 'strategy', 'general'] as AnnotationCategory[])
                .map((x) => <option key={x} value={x}>{catLabel(x)}</option>)}
            </select>
          </div>
          <textarea rows={2} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => props.onDismiss(c)}>{c.dismissed ? '恢复' : '忽略'}</button>
            <button className="primary"
              disabled={c.type === 'term_hit' && senses.length > 1 && !senseId}
              onClick={() => props.onAccept(c, {
                startSec: start, endSec: end, category, text,
                senseId: senseId || undefined
              })}>
              {props.role === 'teacher' ? '接受为教师批注' : '接受为学员批注'}
            </button>
          </div>
          {c.type === 'term_hit' && senses.length > 1 && !senseId &&
            <p className="error-text">同形异义词必须先选定义项才能确认。</p>}
        </div>
      )}
      {c.accepted && <div className="ok-text pill" style={{ marginTop: 4 }}>已确认 → 批注 {c.annotationId?.slice(0, 8)}</div>}
    </div>
  )
}

type CandidatePanelProps2 = (c: Candidate, patch: {
  startSec?: number; endSec?: number; category: AnnotationCategory; text: string; senseId?: string
}) => Promise<void>
