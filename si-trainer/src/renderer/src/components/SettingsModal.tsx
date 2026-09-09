import { useState } from 'react'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [ffmpegPath, setFfmpegPath] = useState('')
  const [ffprobePath, setFfprobePath] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    const s = await window.trainer.settings.get()
    setFfmpegPath(s.ffmpegPath || '')
    setFfprobePath(s.ffprobePath || '')
  }
  void load()

  async function save() {
    await window.trainer.settings.set({
      ffmpegPath: ffmpegPath.trim(),
      ffprobePath: ffprobePath.trim() || undefined
    })
    setMsg('已保存。转码通过受限子进程执行，路径必须指向本机 ffmpeg 可执行文件。')
  }

  async function pick(target: 'ffmpeg' | 'ffprobe') {
    // 复用打开音频对话框选择二进制（Linux/mac 无扩展过滤时选择所有文件）
    const r = await window.trainer.dialog.openAudio()
    if (!r) return
    if (target === 'ffmpeg') setFfmpegPath(r.path)
    else setFfprobePath(r.path)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>本机设置</h3>
        <p className="muted">
          所有导入、转码、录音与加密打包均在本机完成，应用不包含任何上传逻辑。
          FFmpeg 路径需手动指定（不使用 PATH 隐式查找、不联网下载）。
        </p>
        <div className="form-grid">
          <label>FFmpeg</label>
          <div className="row">
            <input style={{ flex: 1 }} value={ffmpegPath} placeholder="/usr/local/bin/ffmpeg"
              onChange={(e) => setFfmpegPath(e.target.value)} />
            <button onClick={() => pick('ffmpeg')}>选择…</button>
          </div>
          <label>FFprobe</label>
          <div className="row">
            <input style={{ flex: 1 }} value={ffprobePath} placeholder="留空则按同目录 ffprobe 推断"
              onChange={(e) => setFfprobePath(e.target.value)} />
            <button onClick={() => pick('ffprobe')}>选择…</button>
          </div>
        </div>
        {msg && <p className="ok-text">{msg}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={onClose}>关闭</button>
          <button className="primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
