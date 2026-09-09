import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import {
  encryptPackage, decryptPackage, assertSafeVirtualPath
} from '../src/shared/crypto-pack'
import { packProject, unpackProject } from '../src/main/package-io'
import { getRoots } from '../src/main/media-store'
import type { PackageManifest } from '../src/shared/types'
import { makeWav, tone } from './helpers'

let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sipkg-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function manifest(files: Record<string, string>): PackageManifest {
  return {
    version: 1,
    project: {
      id: 'proj-1', name: '测试工程', createdAt: 1, updatedAt: 1, lastOpenedAt: 1,
      sourceLanguage: 'zh', targetLanguage: 'en'
    },
    assets: [], terms: [], markers: [], recordings: [], annotations: [], candidates: [],
    files, exportedAt: 1
  }
}

describe('工程加密打包', () => {
  it('正确口令可解包，错误口令抛错且防篡改', () => {
    const payload = {
      manifest: { hello: '世界' },
      files: [{ path: 'projects/proj-1/wav/a.wav', data: Buffer.from('RIFFxxxx') }]
    }
    const buf = encryptPackage(payload, 'correct horse')
    expect(buf.subarray(0, 4).toString('latin1')).toBe('SIP1')
    const dec = decryptPackage(buf, 'correct horse')
    expect(dec.manifest).toEqual({ hello: '世界' })
    expect(dec.files[0].data.toString()).toBe('RIFFxxxx')
    expect(() => decryptPackage(buf, 'wrong')).toThrow(/解密失败/)

    const tampered = Buffer.from(buf)
    tampered[tampered.length - 5] ^= 0xff
    expect(() => decryptPackage(tampered, 'correct horse')).toThrow(/解密失败/)
  })

  it('拒绝路径穿越的虚拟路径', () => {
    expect(() => assertSafeVirtualPath('../etc/passwd')).toThrow()
    expect(() => assertSafeVirtualPath('/abs/path')).toThrow()
    expect(() => assertSafeVirtualPath('a/../b')).toThrow()
    expect(() => assertSafeVirtualPath('projects/p/wav/a.wav')).not.toThrow()
  })

  it('pack/unpack 端到端：媒体字节写入本机媒体目录，路径校验生效', async () => {
    // 1) 在 media/projects 下落一个 wav
    const roots2 = getRoots(dir)
    const wav = makeWav(16000, [tone(16000, 300, 0.2, 0.5)])
    const vpath = 'projects/proj-1/wav/asset-1.wav'
    const abs = join(roots2.mediaDir, vpath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, wav)

    const outPath = join(dir, 'export.sipkg')
    packProject(roots2, outPath, manifest({ 'wav:asset-1': vpath }), 'pw123456')
    expect(existsSync(outPath)).toBe(true)

    // 2) 全新"机器"：空 userData 解包
    const dir2 = mkdtempSync(join(tmpdir(), 'sipkg2-'))
    try {
      const rootsB = getRoots(dir2)
      const { manifest: m, written } = unpackProject(rootsB, outPath, 'pw123456')
      expect(m.project.id).toBe('proj-1')
      expect(written).toContain(vpath)
      expect(readdirSync(join(rootsB.mediaDir, 'projects/proj-1/wav'))).toContain('asset-1.wav')
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('打包阶段即拒绝路径穿越（虚拟路径不允许 ..）', () => {
    expect(() =>
      encryptPackage({ manifest: manifest({ x: '../evil.wav' }), files: [{ path: '../evil.wav', data: Buffer.from('x') }] }, 'pw')
    ).toThrow(/非法包内路径/)
  })

  it('解包只接受 projects/ 与 recordings/ 子树', () => {
    // 手工构造一个路径在别处（技术上通过虚拟路径校验）的包
    const evil = manifest({ x: 'other/evil.wav' })
    const buf = encryptPackage({ manifest: evil, files: [{ path: 'other/evil.wav', data: Buffer.from('x') }] }, 'pw')
    const outPath = join(dir, 'evil.sipkg')
    writeFileSync(outPath, buf)
    expect(() => unpackProject(getRoots(dir), outPath, 'pw')).toThrow(/非法路径/)
  })
})
