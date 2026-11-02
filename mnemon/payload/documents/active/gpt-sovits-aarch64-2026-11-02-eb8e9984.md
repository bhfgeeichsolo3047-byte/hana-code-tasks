---
id: "eb8e9984-e505-4d4d-9a2d-32327a12e3c0"
title: "本地 GPT-SoVITS 离线语音：aarch64 跑通记录与弃用决定（2026-11-02）"
description: "本地 GPT-SoVITS 在手机 aarch64/proot 上跑通的依赖踩坑与 42 秒延迟实测；用户决定语音改走云端 API（脚本 shenjing/tools/tts.mjs + CosyVoice2），本地仅作断网备选。"
status: "active"
created_at: "2026-11-02T06:27:30.640Z"
updated_at: "2026-11-02T06:27:30.640Z"
content_hash: "d3b19dba0f026c258dd5dd1d63066b932649c308e5ec01cd2f28ac508afa8f64"
source_paths:
  - "shenjing/tools/tts.mjs"
session_ids:
  - "3e39025e-3b83-4a5f-a4a9-c7646a5a5c9f"
memory_body_ids:
  []
---

# 本地 GPT-SoVITS 离线语音：aarch64 跑通记录与弃用决定（2026-11-02）

主路径已定为**云端**：脚本 `shenjing/tools/tts.mjs`（输入文本 → 输出 mp3，音色与 API key 内置）调用 SiliconFlow 的 `FunAudioLLM/CosyVoice2-0.5B`，几秒出一条；接口与克隆细节见文档 `a3dadfaf-af3b-4b3c-9696-7c21aaf698ec`（QQ 发语音：SiliconFlow TTS 与声音克隆打通记录）。

## 决定

- 群友原话（1102m）：「别装依赖了，不在本地跑，太慢了，用 api 生成」。据此**不再安装任何本地推理依赖**，语音一律走 API。
- 本地那套原样保留在磁盘上，只作断网时的备选，不删不动。
- 用户在两条候选音色里选了第一条（CosyVoice2 的克隆音色）作为正式音色。

## 本地环境现状（已可跑通，勿再重装依赖）

- 仓库：`/root/GPT-SoVITS`；虚拟环境：`/root/gptsovits/venv`（Python 3.12）；推理脚本 `/root/gptsovits/infer.py`，输出 `/root/gptsovits/out.wav`；参考音频 `/tmp/voicepack/refwav.wav`。
- 权重：`sovits.pth` 84,998,954 字节、`gpt.ckpt` 155MB（与仓库 README 一致）；预训练模型 `GPT_SoVITS/pretrained_models/chinese-hubert-base` 361M、`chinese-roberta-wwm-ext-large` 1.3G。
- `model.safetensors` 在 HF 上 404，实际下载的是 `pytorch_model.bin`，属正常。
- 依赖：torch 2.15.0+cu132 / torchaudio 2.11.1（纯 CPU，8 线程）。

## 性能实测（纯 CPU，手机 proot 环境）

2.9 秒音频总耗时 42.3 秒：初始化 3 秒 + 文本转语义约 35 秒 + 出声 1.8 秒。对话里发语音不可用，这也是转云端的直接原因。

## 踩坑清单（aarch64 / py3.12 特有，重装时按此修）

1. `jieba_fast` 在 aarch64 上编不过（`failed-wheel-build-for-install`），改用普通 `jieba` 并改 `text/chinese.py`、`text/tone_sandhi.py` 的 import，同时处理 `jieba_fast.posseg`。
2. torchaudio 2.11 的 `load()` 走 torchcodec，缺则报 `ImportError: TorchCodec is required`；绕开方式是改用 `soundfile` 读音频（或装 torchcodec）。
3. `resampy` 缺失会在重采样时报 `ModuleNotFoundError`。
4. `fast_langdetect` 缓存目录不存在：`FileNotFoundError: Cache directory not found: .../pretrained_models/fast_langdetect`，手动建目录即可。
5. `opencc` 缺失（`text/g2pw/onnx_api.py` 需要）。
6. `matplotlib` 缺失（`AR/modules/lr_schedulers.py` 顶层 import），装上才过导入。
7. 导入 `TTS_infer_pack` 需 `PYTHONPATH` 指向 `GPT_SoVITS`，否则 `ModuleNotFoundError: No module named 'AR'`。
8. numpy 版本打架：`matplotlib` 会拉到 numpy 2.x，而 GPT-SoVITS 依赖 1.26.4（`contourpy` 要求 >=2.0 的警告可忽略），最终固定 1.26.4。

## 遗留

- 本地路径不做进一步优化；除非断网需求出现，否则不重启这条线。
