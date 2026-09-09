import { describe, it, expect } from 'vitest'
import {
  findTermHits, markHomographs, parseTermsCsv, normalizeSurface
} from '../src/shared/terms'
import type { TermEntry } from '../src/shared/types'
import { uid } from '../src/shared/time'

function term(partial: Partial<TermEntry> & { surface: string; target: string }): TermEntry {
  return {
    id: uid(), projectId: 'p1', homograph: false, createdAt: 1, ...partial
  }
}

describe('术语同形异义', () => {
  it('同 surface 多义项被标记为 homograph', () => {
    const terms = markHomographs([
      term({ surface: ' bank ', target: '银行', senseId: 'finance' }),
      term({ surface: 'Bank', target: '河岸', senseId: 'geo' }),
      term({ surface: 'speech', target: '演讲' })
    ])
    expect(terms[0].homograph).toBe(true)
    expect(terms[1].homograph).toBe(true)
    expect(terms[2].homograph).toBe(false)
    expect(normalizeSurface(' Bank ')).toBe('bank')
  })

  it('命中英文术语时遵守词边界，避免子串误匹配', () => {
    const terms = [term({ surface: 'rate', target: '利率' })]
    const hits = findTermHits('the exchange rate and separate operate', terms)
    // "rate" 命中 1 次；"operate" 内含 rate 不应命中
    expect(hits.filter((h) => h.surface === 'rate')).toHaveLength(1)
  })

  it('中文术语按子串命中（无空格分词）', () => {
    const terms = [
      term({ surface: '量化宽松', target: 'QE' }),
      term({ surface: '通胀', target: 'inflation' })
    ]
    const hits = findTermHits('央行推出量化宽松以对抗通胀', terms)
    expect(hits).toHaveLength(2)
  })

  it('同形异义命中全部作为候选并带 homograph 标记，等待人工消歧', () => {
    const terms = markHomographs([
      term({ surface: 'bass', target: '鲈鱼', senseId: 'fish' }),
      term({ surface: 'bass', target: '低音', senseId: 'music' })
    ])
    const hits = findTermHits('sea bass and bass guitar', terms)
    // 同形异义：两个出现位置 × 两个义项 = 4 条候选，全部交人工消歧
    expect(hits).toHaveLength(4)
    expect(hits.every((h) => h.homograph)).toBe(true)
    const senses = new Set(hits.map((h) => h.senseId))
    expect(senses.size).toBe(2)
    expect(new Set(hits.map((h) => h.start)).size).toBe(2)
  })

  it('解析 CSV 表头并处理引号/逗号', () => {
    const csv = [
      'surface,target,senseId,senseNote,note',
      '"bond","债券",finance,"金融, 债券","含逗号"',
      'bond,粘合,phys,物理,',
      'rate,利率,,,词边界'
    ].join('\n')
    const parsed = parseTermsCsv(csv, 'p1')
    expect(parsed).toHaveLength(3)
    expect(parsed[0].target).toBe('债券')
    expect(parsed[0].senseNote).toBe('金融, 债券')
    expect(parsed[0].homograph).toBe(true)
    expect(parsed[2].homograph).toBe(false)
  })
})
