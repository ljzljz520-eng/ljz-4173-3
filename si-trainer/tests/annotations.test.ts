import { describe, it, expect } from 'vitest'
import {
  addReply, canEditBody, createAnnotation, editBody
} from '../src/shared/annotations'

describe('批注权限：学员回应不覆盖教师意见', () => {
  const teacherAnn = createAnnotation({
    projectId: 'p', startSec: 1, endSec: 2, category: 'omission',
    text: '此处漏译数字 3.2%', authorRole: 'teacher'
  })
  const studentAnn = createAnnotation({
    projectId: 'p', startSec: 3, endSec: 4, category: 'self_correction',
    text: '我把 inflation 改口成滞胀', authorRole: 'student'
  })

  it('学员不能编辑教师批注正文', () => {
    expect(canEditBody(teacherAnn, 'student')).toBe(false)
    expect(() => editBody(teacherAnn, 'student', { text: '覆盖' })).toThrow(/不得覆盖/)
  })

  it('学员只能对教师批注追加回应，原文保持不变', () => {
    const withReply = addReply(teacherAnn, 'student', '听到了但反应慢了')
    expect(withReply.text).toBe(teacherAnn.text)
    expect(withReply.replies).toHaveLength(1)
    expect(withReply.replies[0].authorRole).toBe('student')
    // 不可变：原对象未被修改
    expect(teacherAnn.replies).toHaveLength(0)
    const twice = addReply(withReply, 'teacher', '下次注意预判')
    expect(twice.replies).toHaveLength(2)
    expect(twice.text).toBe('此处漏译数字 3.2%')
  })

  it('教师不覆盖学员原文，只追加回应', () => {
    const replied = addReply(studentAnn, 'teacher', '自我修正意识好，注意术语一致')
    expect(replied.text).toBe(studentAnn.text)
    expect(replied.replies[0].authorRole).toBe('teacher')
    // 教师也可以编辑学员批注？按规则教员以回应为准；canEditBody 允许教师编辑，但产品默认引导用回应
    expect(canEditBody(studentAnn, 'teacher')).toBe(true)
  })

  it('学员可以编辑自己的批注', () => {
    expect(canEditBody(studentAnn, 'student')).toBe(true)
    const edited = editBody(studentAnn, 'student', { text: '改口记录（修订）', category: 'strategy' })
    expect(edited.text).toBe('改口记录（修订）')
    expect(edited.category).toBe('strategy')
    expect(edited.updatedAt).toBeGreaterThanOrEqual(edited.createdAt)
  })

  it('拒绝空内容与非法区间', () => {
    expect(() => createAnnotation({
      projectId: 'p', startSec: 2, endSec: 1, category: 'general', text: 'x', authorRole: 'teacher'
    })).toThrow()
    expect(() => createAnnotation({
      projectId: 'p', startSec: 1, endSec: 2, category: 'general', text: '  ', authorRole: 'teacher'
    })).toThrow()
  })
})
