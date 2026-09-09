// 全局领域类型定义（主进程 / 渲染进程 / 测试共用）

export type ID = string

/** 角色：教师可批注定稿；学员只能新增批注或对教师意见追加回应，不得覆盖 */
export type Role = 'teacher' | 'student'

/** 媒体素材类型 */
export type AssetKind = 'speech' | 'student' | 'reference' | 'aux'

export interface MediaAsset {
  id: ID
  projectId: ID
  kind: AssetKind
  label: string
  /** 用户选择的原始文件名（仅展示用） */
  originalName: string
  /** userData 媒体目录内的相对路径 */
  relPath: string
  /** 转码后统一 WAV（未转码时与 relPath 相同） */
  wavRelPath: string
  sha256: string
  sizeBytes: number
  /** WAV 头解析得到的信息（转码后以 wav 为准） */
  sampleRate: number
  channels: number
  durationSec: number
  /** 源文件解析出的采样率（采样率不一致检测用） */
  sourceSampleRate?: number
  /** 复盘时人工确认的时间轴偏移（秒），正值=该轨需延后对齐主时间轴 */
  trackOffsetSec?: number
  createdAt: number
}

/** 术语条目；同形异义词通过 senseId 区分义项 */
export interface TermEntry {
  id: ID
  projectId: ID
  /** 原形（同形异义词 surface 相同，senseId 不同） */
  surface: string
  /** 义项标识；单义词可留空 */
  senseId?: string
  /** 义项说明（消歧语境） */
  senseNote?: string
  target: string
  note?: string
  /** 是否为程序识别出的同形异义条目 */
  homograph: boolean
  createdAt: number
}

export interface StageMarker {
  id: ID
  projectId: ID
  timeSec: number
  label: string
  note?: string
  createdAt: number
}

/** 录音会话元数据：保存设备、采样率与文件摘要 */
export interface RecordingSession {
  id: ID
  projectId: ID
  assetId?: ID
  label: string
  deviceLabel: string
  deviceId: string
  sampleRate: number
  channels: number
  startedAt: number
  endedAt?: number
  durationSec?: number
  sha256?: string
  sizeBytes?: number
  /** true 表示录音意外终止（进程崩溃/断电/设备掉线），文件经过截断修复 */
  terminatedAbruptly: boolean
  /** 修复后可用时长可能短于预期 */
  salvageNote?: string
}

export type AnnotationCategory =
  | 'omission' // 漏译
  | 'self_correction' // 自我修正
  | 'number_unit' // 数字单位
  | 'strategy' // 表达策略
  | 'general'

export interface AnnotationReply {
  id: ID
  authorRole: Role
  text: string
  createdAt: number
}

export interface Annotation {
  id: ID
  projectId: ID
  /** 关联学员声道素材（可缺省，用于仅在源语轨标注） */
  trackAssetId?: ID
  startSec: number
  endSec: number
  category: AnnotationCategory
  /** 创建者：教师意见学生只读 */
  ownerRole: Role
  text: string
  replies: AnnotationReply[]
  createdAt: number
  updatedAt: number
}

export type CandidateType = 'whisper_gap' | 'term_hit' | 'drift' | 'phase'

export interface Candidate {
  id: ID
  projectId: ID
  type: CandidateType
  startSec: number
  endSec: number
  score: number
  reason: string
  /** 消歧后的义项（术语候选） */
  senseId?: string
  surface?: string
  accepted: boolean
  dismissed: boolean
  /** 接受后转成批注的 id */
  annotationId?: ID
  createdAt: number
}

export interface Project {
  id: ID
  name: string
  speaker?: string
  description?: string
  sourceLanguage?: string
  targetLanguage?: string
  createdAt: number
  updatedAt: number
  /** 最近一次导入/录音等活动时间，用于工程索引 */
  lastOpenedAt: number
}

/** 加密包内清单 */
export interface PackageManifest {
  version: 1
  project: Project
  assets: MediaAsset[]
  terms: TermEntry[]
  markers: StageMarker[]
  recordings: RecordingSession[]
  annotations: Annotation[]
  candidates: Candidate[]
  /** 媒体文件：索引 id -> 包内虚拟路径（不含 ..） */
  files: Record<string, string>
  exportedAt: number
}
