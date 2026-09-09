// 受限 FFmpeg 子进程：
// 1) 二进制路径来自用户设置（设置页显式选择），绝不从 PATH 隐式查找、不随网络下载；
// 2) 参数走固定模板，禁止任意命令行/Shell；
// 3) 输入必须是本机媒体目录内（或显式 allowDirs）的普通文件，拒绝 http(s)/pipe/协议输入。

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'

export interface FfmpegConfig {
  ffmpegPath: string
  ffprobePath?: string
  allowDirs: string[]
}

export interface ProbeResult {
  durationSec: number
  streams: Array<{
    codecType: string
    codecName: string
    sampleRate?: number
    channels?: number
    channelLayout?: string
  }>
  formatName?: string
}

const DANGEROUS_TOKENS = ['-i', 'pipe:', 'file:', 'http://', 'https://', 'tcp://', 'udp://', 'rm ', '&&', '|', ';', '`', '$(']
// 输出/编码参数白名单（值由代码生成，不接受用户原样字符串）
const ALLOWED_FLAGS = new Set([
  '-y', '-hide_banner', '-nostdin', '-loglevel', 'error',
  '-i', '-vn', '-ac', '-ar', '-f', 'wav', '-c:a', 'pcm_s16le',
  '-map_metadata', '-1'
])

export class FfmpegError extends Error {}

function assertLocalInput(input: string, allowDirs: string[]): void {
  if (!isAbsolute(input)) throw new FfmpegError('输入必须为绝对路径')
  const low = input.toLowerCase()
  for (const bad of ['http://', 'https://', 'pipe:', 'file:', '://']) {
    if (low.startsWith(bad) || low.includes(bad)) throw new FfmpegError(`拒绝非本机输入: ${input}`)
  }
  void DANGEROUS_TOKENS
  const st = statSync(input)
  if (!st.isFile()) throw new FfmpegError(`输入不是普通文件: ${input}`)
  const real = resolve(input)
  const allowed = allowDirs.some((dir) => {
    const rel = relative(resolve(dir), real)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
  if (!allowed) throw new FfmpegError('输入路径不在允许的媒体目录内')
}

function assertOutput(output: string, allowDirs: string[]): void {
  const real = resolve(output)
  const allowed = allowDirs.some((dir) => {
    const rel = relative(resolve(dir), real)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
  if (!allowed) throw new FfmpegError('输出路径不在允许的媒体目录内')
}

function assertWhitelistedArgs(args: string[], allowInputs: string[], allowOutputs: string[] = []): void {
  // 除输入文件路径外，所有 token 必须命中白名单或为纯数字（采样率/声道）
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-i') {
      const input = args[i + 1]
      if (!allowInputs.includes(resolve(input))) {
        throw new FfmpegError('未登记的 FFmpeg 输入')
      }
      i++
      continue
    }
    if (ALLOWED_FLAGS.has(a) || /^\d+$/.test(a)) continue
    if (allowOutputs.includes(a)) continue // 登记过的输出路径
    throw new FfmpegError(`参数不在白名单内: ${a}`)
  }
}

function run(bin: string, args: string[], timeoutMs = 120000): Promise<void> {
  return new Promise((res, rej) => {
    if (!existsSync(bin)) return rej(new FfmpegError(`找不到 FFmpeg 可执行文件: ${bin}`))
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rej(new FfmpegError('FFmpeg 执行超时'))
    }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); rej(new FfmpegError(e.message)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) res()
      else rej(new FfmpegError(`FFmpeg 退出码 ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

function runJson(bin: string, args: string[], timeoutMs = 60000): Promise<unknown> {
  return new Promise((res, rej) => {
    if (!existsSync(bin)) return rej(new FfmpegError(`找不到可执行文件: ${bin}`))
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    const timer = setTimeout(() => { child.kill('SIGKILL'); rej(new FfmpegError('探测超时')) }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); rej(new FfmpegError(e.message)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return rej(new FfmpegError(`探测失败: ${err.slice(-1000)}`))
      try { res(JSON.parse(out)) } catch (e) { rej(new FfmpegError(`探测输出解析失败: ${(e as Error).message}`)) }
    })
  })
}

export async function probeMedia(cfg: FfmpegConfig, input: string): Promise<ProbeResult> {
  assertLocalInput(input, cfg.allowDirs)
  const bin = cfg.ffprobePath || cfg.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
  if (!existsSync(bin)) throw new FfmpegError('未找到 ffprobe，请在设置中指定')
  const json: any = await runJson(bin, [
    '-hide_banner', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', resolve(input)
  ])
  return {
    durationSec: Number(json.format?.duration ?? 0),
    formatName: json.format?.format_name,
    streams: (json.streams ?? []).map((s: any) => ({
      codecType: s.codec_type,
      codecName: s.codec_name,
      sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
      channels: s.channels,
      channelLayout: s.channel_layout
    }))
  }
}

/**
 * 固定转码模板：音频 -> 48kHz 16-bit PCM WAV。
 * 讲话素材默认 down-mix 单声道（复盘对齐更稳）；学员录音保留声道由调用方决定。
 */
export async function transcodeToWav(
  cfg: FfmpegConfig,
  input: string,
  output: string,
  channels: 1 | 2
): Promise<void> {
  const inReal = resolve(input)
  const outReal = resolve(output)
  assertLocalInput(inReal, cfg.allowDirs)
  assertOutput(outReal, cfg.allowDirs)
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-i', inReal,
    '-vn',
    '-ac', String(channels),
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    '-map_metadata', '-1',
    '-f', 'wav',
    outReal
  ]
  assertWhitelistedArgs(args, [inReal], [outReal])
  await run(cfg.ffmpegPath, args)
}

export function ffmpegConfigured(cfg: FfmpegConfig | null): boolean {
  return Boolean(cfg && cfg.ffmpegPath && existsSync(cfg.ffmpegPath))
}
