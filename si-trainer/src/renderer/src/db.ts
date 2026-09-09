import Dexie, { type Table } from 'dexie'
import type {
  Project, MediaAsset, TermEntry, StageMarker,
  RecordingSession, Annotation, Candidate
} from '../../shared/types'

/**
 * Dexie 只保存"工程索引"（元数据、批注、候选、术语、会话），
 * 音频字节保存在主进程 userData/media，绝不上传云端。
 */
class TrainerDB extends Dexie {
  projects!: Table<Project, string>
  assets!: Table<MediaAsset, string>
  terms!: Table<TermEntry, string>
  markers!: Table<StageMarker, string>
  recordings!: Table<RecordingSession, string>
  annotations!: Table<Annotation, string>
  candidates!: Table<Candidate, string>

  constructor() {
    super('si-trainer')
    this.version(1).stores({
      projects: 'id, updatedAt, lastOpenedAt',
      assets: 'id, projectId, kind',
      terms: 'id, projectId, surface',
      markers: 'id, projectId, timeSec',
      recordings: 'id, projectId, endedAt, terminatedAbruptly',
      annotations: 'id, projectId, trackAssetId, category',
      candidates: 'id, projectId, type, accepted, dismissed'
    })
  }
}

export const db = new TrainerDB()

export interface FullProjectBundle {
  project: Project
  assets: MediaAsset[]
  terms: TermEntry[]
  markers: StageMarker[]
  recordings: RecordingSession[]
  annotations: Annotation[]
  candidates: Candidate[]
}

export async function loadBundle(projectId: string): Promise<FullProjectBundle> {
  const [project, assets, terms, markers, recordings, annotations, candidates] = await Promise.all([
    db.projects.get(projectId),
    db.assets.where('projectId').equals(projectId).toArray(),
    db.terms.where('projectId').equals(projectId).toArray(),
    db.markers.where('projectId').equals(projectId).toArray(),
    db.recordings.where('projectId').equals(projectId).toArray(),
    db.annotations.where('projectId').equals(projectId).toArray(),
    db.candidates.where('projectId').equals(projectId).toArray()
  ])
  if (!project) throw new Error('工程不存在')
  markers.sort((a, b) => a.timeSec - b.timeSec)
  annotations.sort((a, b) => a.startSec - b.startSec)
  return { project, assets, terms, markers, recordings, annotations, candidates }
}

/** 导入加密包时整体 upsert（保留原 id；与现有工程 id 冲突时调用方先确认覆盖） */
export async function upsertBundle(b: FullProjectBundle): Promise<void> {
  await db.transaction('rw', [db.projects, db.assets, db.terms, db.markers, db.recordings, db.annotations, db.candidates],
    async () => {
      await db.projects.put(b.project)
      await db.assets.bulkPut(b.assets)
      await db.terms.bulkPut(b.terms)
      await db.markers.bulkPut(b.markers)
      await db.recordings.bulkPut(b.recordings)
      await db.annotations.bulkPut(b.annotations)
      await db.candidates.bulkPut(b.candidates)
    })
}

export async function deleteProjectCascade(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.assets, db.terms, db.markers, db.recordings, db.annotations, db.candidates],
    async () => {
      await db.projects.delete(projectId)
      await db.assets.where('projectId').equals(projectId).delete()
      await db.terms.where('projectId').equals(projectId).delete()
      await db.markers.where('projectId').equals(projectId).delete()
      await db.recordings.where('projectId').equals(projectId).delete()
      await db.annotations.where('projectId').equals(projectId).delete()
      await db.candidates.where('projectId').equals(projectId).delete()
    })
}

export async function hasProject(id: string): Promise<boolean> {
  return Boolean(await db.projects.get(id))
}
