# 本地 TTS · Windows 重搭（2026-10-26）

昨天那套在手机上（`/root/models/kokoro/`），今天换了台机器，那些路径全空。
这台机器上重新装了一遍，路径换成 Windows 的。

## 装在哪

| 东西 | 位置 |
|---|---|
| 目录 | `F:\小鲸\models\kokoro` |
| venv | `F:\小鲸\models\kokoro\.venv`（python 3.11） |
| 模型（Kokoro-82M 量化 ONNX，92MB） | `F:\小鲸\models\kokoro\model_quantized.onnx` |
| 音色库（54 个，v1.0 bin，28MB） | `F:\小鲸\models\kokoro\voices-v1.0.bin` |
| 调用脚本 | `F:\小鲸\models\kokoro\tts.py` |
| 快捷入口 | `F:\小鲸\models\kokoro\say.ps1` |

## 怎么用

```powershell
F:\小鲸\models\kokoro\.venv\Scripts\python.exe F:\小鲸\models\kokoro\tts.py "要读的话" -v zf_xiaobei -s 0.9 -o out.wav
powershell -NoProfile -ExecutionPolicy Bypass -File F:\小鲸\models\kokoro\say.ps1 "要读的话" out.wav
.\.venv\Scripts\python.exe tts.py --list                 # 列音色
```

（先写过 say.cmd，`%ROOT%` 那行在 cmd 里被拆坏了；换 PowerShell 脚本，路径按脚本自身位置推。）

## 依赖（venv 里已装）

`onnxruntime 1.31.0`、`kokoro-onnx 0.6.1`、`misaki 0.9.4`（带 zh）、`soundfile`、`lameenc`、`numpy`。
装的时候用清华镜像，别的没什么坑。

## 中文音色的基频实测（2026-10-26，自相关逐帧取中位）

| 音色 | 中位 F0 |
|---|---|
| zm_yunjian | 119.7 Hz |
| zm_yunyang | 127.0 Hz |
| zm_yunxi | 167.8 Hz |
| zf_xiaobei | 230.8 Hz |
| zf_xiaoni | 230.8 Hz |
| zf_xiaoxiao | 236.5 Hz |
| zm_yunxia | 284.0 Hz |
| zf_xiaoyi | 296.3 Hz |

昨天说"zf_xiaobei 是女声里最低、235Hz"——数值对得上（230~235 的差别是量法不同），但**没发现 zf_xiaoni 跟它一样**。
所以"挑了个最不晓伊的"这个说法站不住，只能算"挑了个中间偏低的"。

## 坑（照旧要补的）

1. **onnx-community 的导出图要 style 是 (1,256)**，kokoro-onnx 0.6.1 传一维 (256,)。`tts.py` 里 monkeypatch 了 `_style_for`，reshape 到 `(1,-1)`。
2. 中文不走 espeak，走 `misaki.zh.ZHG2P()`，拿音素后 `is_phonemes=True`。
3. 这台机器**有** ffmpeg（跟手机上不一样），mp3 不用非靠 lameenc；但脚本里留了 lameenc 那条路。
4. 每次跑会看到 jieba 往 stderr 打 "Building prefix dict..."，不是报错，powershell 会把它标成 NativeCommandError，别被吓到。

## 还没做的

朗读插件 `dsh-read-aloud-neural` 在这台机器上根本不存在（desktop profile 的依赖里没有）。
所以"把朗读插件接到本地 TTS"这条待办的前提没了：先得把插件找回来，才轮得到改服务端音源。
