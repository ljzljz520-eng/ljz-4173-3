// 工程加密包与本机媒体目录之间的组装/解包
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { encryptPackage, decryptPackage, assertSafeVirtualPath } from '../shared/crypto-pack'
import { assertInside, type MediaRoots } from './media-store'
import type { PackageManifest } from '../shared/types'

/** 打包：manifest.files 为 逻辑id -> 媒体目录相对路径 的映射 */
export function packProject(
  roots: MediaRoots,
  outputPath: string,
  manifest: PackageManifest,
  passphrase: string
): { bytes: number; fileCount: number } {
  const entries = Object.entries(manifest.files)
  const files = entries.map(([id, vpath]) => {
    assertSafeVirtualPath(vpath)
    // 虚拟路径即媒体目录相对路径，双重校验
    const abs = resolve(roots.mediaDir, vpath)
    assertInside(roots.mediaDir, abs)
    if (!existsSync(abs)) throw new Error(`工程引用的媒体文件缺失: ${id} -> ${vpath}`)
    return { path: vpath, data: readFileSync(abs) }
  })
  const buf = encryptPackage({ manifest, files }, passphrase)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, buf)
  return { bytes: buf.length, fileCount: files.length }
}

export function unpackProject(
  roots: MediaRoots,
  inputPath: string,
  passphrase: string
): { manifest: PackageManifest; written: string[] } {
  if (!existsSync(inputPath)) throw new Error('工程包不存在')
  const { manifest, files } = decryptPackage(readFileSync(inputPath), passphrase)
  const m = manifest as PackageManifest
  if (!m || m.version !== 1 || !m.project?.id) throw new Error('工程包清单无效')
  const written: string[] = []
  for (const f of files) {
    assertSafeVirtualPath(f.path)
    // 仅允许写入 projects/ 与 recordings/ 两个子树
    if (!f.path.startsWith('projects/') && !f.path.startsWith('recordings/')) {
      throw new Error(`工程包含非法路径: ${f.path}`)
    }
    const abs = join(roots.mediaDir, f.path)
    assertInside(roots.mediaDir, abs)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.data)
    written.push(relative(roots.mediaDir, abs))
  }
  // 清单列出的文件必须与包内一致
  for (const v of Object.values(m.files)) assertSafeVirtualPath(v)
  return { manifest: m, written }
}
