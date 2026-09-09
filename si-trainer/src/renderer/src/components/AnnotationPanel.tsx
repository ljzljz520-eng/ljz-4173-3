import { useState } from 'react'
import type { Annotation, AnnotationCategory, Role } from '../../../shared/types'
import { formatClock } from '../../../shared/time'

const CATEGORIES: { v: AnnotationCategory; label: string }[] = [
  { v: 'omission', label: '漏译' },
  { v: 'self_correction', label: '自我修正' },
  { v: 'number_unit', label: '数字单位' },
  { v: 'strategy', label: '表达策略' },
  { v: 'general', label: '其他' }
]

export function catLabel(c: AnnotationCategory): string {
  return CATEGORIES.find((x) => x.v === c)?.label ?? c
}

export function catColor(c: AnnotationCategory): string {
  switch (c) {
    case 'omission': return 'var(--danger)'
    case 'self_correction': return 'var(--warn)'
    case 'number_unit': return 'var(--ref)'
    case 'strategy': return 'var(--accent2)'
    default: return 'var(--muted)'
  }
}

export function AnnotationPanel(props: {
  role: Role
  selection: { startSec: number; endSec: number } | null
  annotations: Annotation[]
  activeAt: number
  canEditBody: (a: Annotation, role: Role) => boolean
  onAdd: (category: AnnotationCategory, text: string) => Promise<void>
  onReply: (id: string, text: string) => Promise<void>
  onEdit: (id: string, text: string, category: AnnotationCategory) => Promise<void>
  onSeek: (sec: number) => void
  transcriptSlot?: React.ReactNode
}) {
  const [text, setText] = useState('')
  const [cat, setCat] = useState<AnnotationCategory>('omission')
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [editFor, setEditFor] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editCat, setEditCat] = useState<AnnotationCategory>('general')
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    try { await props.onAdd(cat, text); setText('') } catch (e) { setError((e as Error).message) }
  }

  async function submitReply(id: string) {
    setError('')
    try { await props.onReply(id, replyText); setReplyText(''); setReplyFor(null) }
    catch (e) { setError((e as Error).message) }
  }

  async function submitEdit(id: string) {
    setError('')
    try { await props.onEdit(id, editText, editCat); setEditFor(null) }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <div>
      {props.transcriptSlot}
      <div className="panel-box">
        <h2>片段批注</h2>
        {!props.selection && <p className="muted">在波形上拖拽选择具体片段后可标注。</p>}
        {props.selection && (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <select value={cat} onChange={(e) => setCat(e.target.value as AnnotationCategory)}>
              {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
            <textarea rows={2} style={{ flex: 1 }} value={text}
              placeholder={props.role === 'teacher' ? '教师意见（学员不可覆盖）' : '学员批注（教师可回应，不覆盖学员原文）'}
              onChange={(e) => setText(e.target.value)} />
            <button className="primary" disabled={!text.trim()} onClick={submit}>添加</button>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}

        <div style={{ marginTop: 12, maxHeight: 420, overflow: 'auto' }}>
          {[...props.annotations].sort((a, b) => a.startSec - b.startSec).map((a) => {
            const editable = props.canEditBody(a, props.role)
            const active = a.startSec <= props.activeAt && a.endSec >= props.activeAt
            return (
              <div key={a.id} className={`annotation ${a.ownerRole}`} style={active ? { outline: '1px solid var(--accent)' } : undefined}>
                <div className="row">
                  <span className="tag" style={{ color: catColor(a.category), borderColor: catColor(a.category) }}>{catLabel(a.category)}</span>
                  <span className="pill">{a.ownerRole === 'teacher' ? '教员' : '学员'}</span>
                  <button className="pill" style={{ padding: '0 6px' }} onClick={() => props.onSeek(a.startSec)}>
                    {formatClock(a.startSec)}–{formatClock(a.endSec)}
                  </button>
                  <span className="spacer" style={{ flex: 1 }} />
                  {editable && (
                    <button style={{ padding: '0 8px' }} onClick={() => {
                      setEditFor(a.id); setEditText(a.text); setEditCat(a.category)
                    }}>编辑</button>
                  )}
                  {!editable && props.role === 'student' && (
                    <span className="pill">教师意见·只读</span>
                  )}
                </div>
                {editFor === a.id ? (
                  <div className="row" style={{ marginTop: 6 }}>
                    <select value={editCat} onChange={(e) => setEditCat(e.target.value as AnnotationCategory)}>
                      {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                    </select>
                    <textarea rows={2} style={{ flex: 1 }} value={editText} onChange={(e) => setEditText(e.target.value)} />
                    <button onClick={() => setEditFor(null)}>取消</button>
                    <button className="primary" onClick={() => submitEdit(a.id)}>保存</button>
                  </div>
                ) : (
                  <div style={{ margin: '4px 0' }}>{a.text}</div>
                )}
                <div className="replies">
                  {a.replies.map((r) => (
                    <div key={r.id} className="reply">
                      <b>{r.authorRole === 'teacher' ? '教员' : '学员'}回应：</b>{r.text}
                      <span className="pill"> {new Date(r.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                  {replyFor === a.id ? (
                    <div className="row" style={{ marginTop: 4 }}>
                      <input style={{ flex: 1 }} value={replyText} autoFocus
                        placeholder={props.role === 'teacher' ? '教员回应（不覆盖学员原文）' : '学员回应（不覆盖教师意见）'}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submitReply(a.id) }} />
                      <button onClick={() => setReplyFor(null)}>取消</button>
                      <button className="primary" disabled={!replyText.trim()} onClick={() => submitReply(a.id)}>发送</button>
                    </div>
                  ) : (
                    <button style={{ marginTop: 4, padding: '2px 8px' }}
                      onClick={() => { setReplyFor(a.id); setReplyText('') }}>
                      + 回应（仅追加）
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {props.annotations.length === 0 && <p className="muted">暂无批注。</p>}
        </div>
      </div>
    </div>
  )
}
