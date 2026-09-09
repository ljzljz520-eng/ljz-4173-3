# 同声传译训练复盘室（SI Trainer）

Electron + React 桌面应用，把 **原语音 / 学员译音 / 延迟（漂移）/ 术语处理** 放在同一条时间轴上复盘。

**隐私边界（硬约束）**：应用不含任何上传/网络上报逻辑。导入、转码、录音、分析、加密打包全部在本机完成；
录音字节只写入系统 `userData/media` 目录，Dexie（IndexedDB）仅保存工程索引与批注元数据。

## 功能对照

| 需求 | 实现 |
| --- | --- |
| 桌面端 | Electron 31 + React 18 + electron-vite + TypeScript（strict） |
| 工程索引 | Dexie 7 张表：projects/assets/terms/markers/recordings/annotations/candidates |
| 媒体转码 | **受限 FFmpeg 子进程**：显式二进制路径、参数白名单、仅允许媒体目录本机文件、拒绝 http/pipe/file 协议、无 shell |
| 播放 | Web Audio API 多轨 `AudioBufferSourceNode` 调度，统一主时间轴 + 每轨漂移偏移 |
| 教员导入 | 讲话音频（自动转 48k/16-bit WAV）、参考术语 CSV、阶段标记、可选参考音频 |
| 学员录音 | 保存设备 label/deviceId、实际采样率、声道数、SHA-256、时长；每秒增量落盘 |
| 耳语间隔 | 低能量可闻声段候选（能量带 + 最短时长 + 合并近邻 + 置信度） |
| 片段标注 | 漏译 / 自我修正 / 数字单位 / 表达策略（+其他） |
| 自动结果 | 耳语/术语/漂移/阶段**只生成候选**，必须人工接受后才成为批注 |
| 批注权限 | 学员**只能对教师意见追加回应**，不能覆盖；教师亦不覆盖学员原文，回复只追加 |
| 工程打包 | `.sipkg`：scrypt(N=16384) + AES-256-GCM + zlib，GCM 防篡改，包内路径穿越校验 |

## 指定 FFmpeg

设置 → 选择本机 `ffmpeg`（ffprobe 可留空按同目录推断）。
不配置时仅能直接导入 WAV（复制入库，不转码）。应用**不**从 PATH 隐式查找、不联网下载。

## 开发

```bash
npm install
npm run dev          # 启动 Electron 开发（需要桌面环境）
npm test             # vitest：31 个用例
npm run typecheck    # tsc strict（主进程 + 渲染端两份 tsconfig）
npm run build
```

## 四类边界场景的处理

1. **双声道漂移** — `shared/drift.ts` 用 50ms RMS 包络归一化互相关估计学员轨滞后秒数与置信度，
   在复盘页给出偏移建议，教员一键应用或手动微调；偏移持久化到素材 `trackOffsetSec`。
2. **采样率不一致** — FFmpeg 统一转 48k WAV，同时保留 `sourceSampleRate`；
   素材页显示"源 xxHz → 统一 48000Hz"警示；录音记录设备声明采样率与 AudioContext 采样率差异。
3. **术语同形异义** — CSV 中同 surface 不同 senseId/译文自动标记；扫描命中时每个位置产生**每个义项一条候选**，
   UI 强制选择义项后才能确认。
4. **录音突然终止** — 录音先写 WAV 头再增量追加 PCM（`.part`）。崩溃/断电/设备掉线后，
   进入录音页自动检测遗留 `.part`，`salvageWav` 丢弃不完整帧、重写 RIFF/data 尺寸，
   会话标记 `terminatedAbruptly` 并带恢复说明，再入库。

## 安全加固

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webviewTag: false`
- 渲染进程经 contextBridge 白名单 API 访问能力；文件读取经自定义 `secure-media://` 协议并做目录穿越校验
- 生产 CSP：`default-src 'self'; media-src 'self' secure-media:; object-src 'none'; base-uri 'none'`
- 外部链接禁止在应用窗口内导航，交给系统浏览器

## 目录

```
src/shared     领域类型、WAV、耳语分析、漂移、术语、批注权限、加密包（可单测）
src/main       主进程：受限 FFmpeg、媒体存储、IPC、安全媒体协议、设置、打包
src/preload    contextBridge 白名单
src/renderer   React：工程列表/素材/录音/复盘（引擎、波形、批注、候选）
tests          漂移、采样率/截断修复、同形异义、耳语、权限、加密包、FFmpeg 护栏
samples        含同形异义词的术语 CSV 示例
```

## 数据存放位置（本机）

- 索引（Dexie/IndexedDB）：Chromium 用户目录下应用分区
- 音频字节：`app.getPath('userData')/media/`
  - `projects/<id>/orig/` 用户原始文件副本（保留原扩展名，做证据留存）
  - `projects/<id>/wav/` 转码后的 48k WAV
  - `recordings/<session>.wav.part` 录制中（每秒追加）；正常/修复后变为 `.wav`

## 自动分析与人工确认的边界

- 耳语间隔、双声道漂移、术语命中、阶段标记**统一进入"候选"列表**，不会直接生成批注或修改译文；
- 每条候选需选择分类、核对（必要时拖拽修正）时间区间后，由当前身份"接受"才落为批注；
- 同形异义术语必须先选定义项；漂移建议必须点击"应用"才改变轨道偏移。

## 已自动化测试的边界场景（`npm test`，33 用例 / 8 文件）

- **双声道漂移**：5 段包络信号整体延迟 0.8s，估计值落在 [0.55, 1.05]s 且置信度 > 0.3；无共同信号时安全返回。
- **采样率不一致**：44.1k 双声道 round-trip、48k→16k 线性重采样时长比例、22.05k 源识别。
- **录音突然终止**：70% 截断且切断点落在帧中间 → 修复后尺寸自洽、无残缺帧、时长受限；完好文件不重复修复；无 RIFF 头时报错。
- **正常结束占位头回填**：流式 WAV 头部占位（RIFF/data 尺寸）在收尾时按实际字节重写并给出正确 SHA-256。
- **术语同形异义**：同 surface 多义项标记；英文词边界（operate 内的 rate 不误命中）；中文子串命中；每个位置 × 每个义项都成候选；CSV 引号/逗号解析。
- **批注权限**：学员不能改教师正文（抛错）、只能追加回应且教师原文不变；教师回应不覆盖学员原文；空内容/非法区间拒绝。
- **耳语候选**：低能量可闻段被识别、纯静音不识别、短于阈值不识别。
- **加密包**：正确/错误口令、GCM 篡改检测、路径穿越拒绝、pack/unpack 端到端、子树限制。
- **受限 FFmpeg**：目录外输入、http/pipe/file 协议、不存在二进制、缺失 ffprobe 全部拒绝。
