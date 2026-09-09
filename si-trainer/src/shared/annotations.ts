// 批注权限规则（单一事实来源，UI 与测试共用）：
// - 教师批注：学员只能追加回应，不能修改/删除正文与分类；
// - 学员批注：本人可改；教师可追加回应与结案说明，但不覆盖学员原文；
// - 任何"回应"都只追加，历史回应不可变。

import type { Annotation, AnnotationCategory, AnnotationReply, Role } from './types'
import { uid } from './time'

export interface NewAnnotationInput {
  projectId: string
  trackAssetId?: string
  startSec: number
  endSec: number
  category: AnnotationCategory
  text: string
  authorRole: Role
}

export function createAnnotation(input: NewAnnotationInput, now = Date.now()): Annotation {
  if (!(input.endSec > input.startSec)) {
    throw new Error('批注区间结束时间必须晚于开始时间')
  }
  if (!input.text.trim()) throw new Error('批注内容不能为空')
  return {
    id: uid(),
    projectId: input.projectId,
    trackAssetId: input.trackAssetId,
    startSec: input.startSec,
    endSec: input.endSec,
    category: input.category,
    ownerRole: input.authorRole,
    text: input.text.trim(),
    replies: [],
    createdAt: now,
    updatedAt: now
  }
}

export function canEditBody(a: Annotation, role: Role): boolean {
  return role === 'teacher' || a.ownerRole === 'student'
}

/** 学员回应教师批注：仅追加回复，绝不覆盖教师意见 */
export function addReply(a: Annotation, role: Role, text: string, now = Date.now()): Annotation {
  const t = text.trim()
  if (!t) throw new Error('回应内容不能为空')
  const reply: AnnotationReply = { id: uid(), authorRole: role, text: t, createdAt: now }
  return { ...a, replies: [...a.replies, reply], updatedAt: now }
}

export function editBody(a: Annotation, role: Role, patch: { text?: string; category?: AnnotationCategory }, now = Date.now()): Annotation {
  if (!canEditBody(a, role)) {
    throw new Error('学员不得覆盖教师意见，只能追加回应')
  }
  const text = patch.text !== undefined ? patch.text.trim() : a.text
  if (!text) throw new Error('批注内容不能为空')
  return {
    ...a,
    text,
    category: patch.category ?? a.category,
    updatedAt: now
  }
}

/** 时间区间可由教师微调；学员仅可调整自己创建的批注 */
export function canEditRange(a: Annotation, role: Role): boolean {
  return role === 'teacher' || a.ownerRole === 'student'
}
