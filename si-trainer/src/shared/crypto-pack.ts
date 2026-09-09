// 工程加密打包（.sipkg）：所有处理均在本机完成，不上传云端。
// 格式：magic(4) | version(u16) | salt(16) | iv(12) | tag(16) | 密文(zlib(JSON+文件))
// 密钥由口令经 scrypt 派生；GCM 防篡改；包内路径做穿越校验。

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'

export const PACKAGE_MAGIC = Buffer.from('SIP1')
const VERSION = 1
export const PACKAGE_EXT = '.sipkg'

export interface PackFile {
  path: string // 包内相对路径，使用正斜杠
  data: Buffer
}

export interface PackPayload {
  manifest: unknown
  files: PackFile[]
}

/** 包内虚拟路径安全检查：禁止绝对路径与 .. 穿越 */
export function assertSafeVirtualPath(p: string): void {
  if (!p || p.includes('\\')) throw new Error(`非法包内路径: ${p}`)
  if (p.startsWith('/')) throw new Error(`非法包内路径: ${p}`)
  const parts = p.split('/')
  if (parts.some((x) => x === '..' || x === '' )) {
    throw new Error(`非法包内路径: ${p}`)
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })
}

export function encryptPackage(payload: PackPayload, passphrase: string): Buffer {
  for (const f of payload.files) assertSafeVirtualPath(f.path)
  const json = Buffer.from(JSON.stringify(payload.manifest), 'utf8')
  const parts: Buffer[] = [
    Buffer.from([0x01]), // 子段类型：manifest JSON
    uint32(json.length), json
  ]
  const seen = new Set<string>()
  for (const f of payload.files) {
    if (seen.has(f.path)) throw new Error(`包内文件重复: ${f.path}`)
    seen.add(f.path)
    const pathBuf = Buffer.from(f.path, 'utf8')
    parts.push(Buffer.from([0x02]), uint32(pathBuf.length), pathBuf, uint32(f.data.length), f.data)
  }
  parts.push(Buffer.from([0x00]))
  const raw = Buffer.concat(parts)
  const compressed = deflateSync(raw, { level: 6 })

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(compressed), cipher.final()])
  const tag = cipher.getAuthTag()

  const header = Buffer.alloc(4 + 2)
  PACKAGE_MAGIC.copy(header, 0)
  header.writeUInt16LE(VERSION, 4)
  return Buffer.concat([header, salt, iv, tag, ct])
}

export function decryptPackage(pack: Buffer, passphrase: string): PackPayload {
  if (pack.length < 4 + 2 + 16 + 12 + 16 || !pack.subarray(0, 4).equals(PACKAGE_MAGIC)) {
    throw new Error('不是有效的工程包文件')
  }
  const version = pack.readUInt16LE(4)
  if (version !== VERSION) throw new Error(`不支持的工程包版本: ${version}`)
  let off = 6
  const salt = pack.subarray(off, off + 16); off += 16
  const iv = pack.subarray(off, off + 12); off += 12
  const tag = pack.subarray(off, off + 16); off += 16
  const ct = pack.subarray(off)

  const key = deriveKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  let decompressed: Buffer
  try {
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]) // GCM 校验失败在此抛出
    decompressed = inflateSync(dec)
  } catch (e) {
    throw new Error(`解密失败（口令错误或包已损坏）: ${(e as Error).message}`)
  }

  return parsePayload(decompressed)
}

function parsePayload(raw: Buffer): PackPayload {
  let p = 0
  const u32 = () => {
    if (p + 4 > raw.length) throw new Error('工程包数据不完整')
    const v = raw.readUInt32LE(p); p += 4; return v
  }
  if (raw[p++] !== 0x01) throw new Error('工程包缺少清单段')
  const jsonLen = u32()
  const manifest = JSON.parse(raw.subarray(p, p + jsonLen).toString('utf8'))
  p += jsonLen
  const files: PackFile[] = []
  while (p < raw.length) {
    const type = raw[p++]
    if (type === 0x00) break
    if (type !== 0x02) throw new Error(`未知段类型 ${type}`)
    const pathLen = u32()
    const path = raw.subarray(p, p + pathLen).toString('utf8'); p += pathLen
    assertSafeVirtualPath(path)
    const dataLen = u32()
    const data = Buffer.from(raw.subarray(p, p + dataLen)); p += dataLen
    files.push({ path, data })
  }
  return { manifest, files }
}

function uint32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}
