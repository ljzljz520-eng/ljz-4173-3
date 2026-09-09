// 术语处理：支持同形异义词（surface 相同、义项不同）。
// 匹配仅做候选定位，义项需要教员/学员在具体片段确认，不自动定稿译文。

import type { TermEntry } from './types'
import { uid } from './time'

export function normalizeSurface(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isCjk(ch: string): boolean {
  return /[㐀-鿿豈-﫿]/.test(ch)
}

/** 标记同形异义：同形（规范化后）但存在多个不同义项（senseId 或译文不同） */
export function markHomographs(terms: TermEntry[]): TermEntry[] {
  const groups = new Map<string, TermEntry[]>()
  for (const t of terms) {
    const key = normalizeSurface(t.surface)
    const arr = groups.get(key) ?? []
    arr.push(t)
    groups.set(key, arr)
  }
  return terms.map((t) => {
    const arr = groups.get(normalizeSurface(t.surface))!
    const senseKeys = new Set(arr.map((x) => x.senseId || x.target))
    return { ...t, homograph: senseKeys.size > 1 }
  })
}

export interface TermHit {
  termId: ID
  surface: string
  start: number
  end: number
  homograph: boolean
  senseId?: string
  target: string
}

type ID = string

/** 在转写文本中查找术语命中；同形异义条目全部作为候选返回，要求人工消歧 */
export function findTermHits(text: string, terms: TermEntry[]): TermHit[] {
  const hits: TermHit[] = []
  const lower = text.toLowerCase()
  for (const term of terms) {
    const surface = normalizeSurface(term.surface)
    if (!surface) continue
    let from = 0
    while (from <= lower.length) {
      const idx = lower.indexOf(surface, from)
      if (idx < 0) break
      const end = idx + surface.length
      const boundaryOk = checkBoundary(lower, idx, end, surface)
      if (boundaryOk) {
        hits.push({
          termId: term.id,
          surface: term.surface,
          start: idx,
          end,
          homograph: term.homograph,
          senseId: term.senseId,
          target: term.target
        })
      }
      from = idx + Math.max(1, surface.length)
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

function checkBoundary(text: string, start: number, end: number, surface: string): boolean {
  // 含 CJK 的术语不做空格词边界判断；纯拉丁/数字要求两侧为非字母数字
  if (/[一-鿿]/.test(surface)) {
    // CJK 子串直接命中（中文无空格分词）
    return true
  }
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  const wordish = (c: string) => /[a-z0-9'’-]/.test(c)
  if (wordish(before) || wordish(after)) return false
  void isCjk
  return true
}

/**
 * 解析术语 CSV：列 surface,target,senseId,senseNote,note（首行表头）。
 * surface 相同且 senseId/译文不同的条目自动标记 homograph。
 */
export function parseTermsCsv(csv: string, projectId: string): TermEntry[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const idx = (name: string) => header.indexOf(name)
  const iSurface = idx('surface')
  const iTarget = idx('target')
  if (iSurface < 0 || iTarget < 0) {
    throw new Error('术语 CSV 必须包含 surface 和 target 列')
  }
  const iSense = idx('senseid')
  const iSenseNote = idx('sensenote')
  const iNote = idx('note')
  const entries: TermEntry[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const surface = (row[iSurface] ?? '').trim()
    const target = (row[iTarget] ?? '').trim()
    if (!surface) continue
    entries.push({
      id: uid(),
      projectId,
      surface,
      target,
      senseId: iSense >= 0 ? row[iSense]?.trim() || undefined : undefined,
      senseNote: iSenseNote >= 0 ? row[iSenseNote]?.trim() || undefined : undefined,
      note: iNote >= 0 ? row[iNote]?.trim() || undefined : undefined,
      homograph: false,
      createdAt: Date.now()
    })
  }
  return markHomographs(entries)
}

/** 极简 CSV 解析，支持双引号包裹与转义 "" */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      pushField()
    } else if (c === '\n') {
      pushRow()
    } else if (c === '\r') {
      // 跳过，\n 负责断行
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) pushRow()
  return rows
}
