---
id: "daa0aa17-539a-4839-ad68-9e9a47fe9aea"
title: "大肥鱼 GPT-SoVITS v2 音色训练与交付（2026-10-25）"
description: "纯 CPU 训出 daFeiYu 音色的完整参数、三句客观验收数据、五个必须记住的坑（custom 键、假 EXIT=0、缺失输出目录、generator/resampy、rich 假失败），以及样本推送到记忆 git 仓库的位置。"
status: "active"
created_at: "2026-10-25T11:02:53.034Z"
updated_at: "2026-10-25T11:02:53.034Z"
content_hash: "bf2f3fef50d2f24854d35455abb8ec5320846d81954ec117f3568a899670e2af"
source_paths:
  - "deliver/manifest.json"
  - "deliver/README.md"
  - "deliver/samples/text.txt"
session_ids:
  - "session-871be7a0-e696-4d73-a893-3a7ba9a0c96a"
memory_body_ids:
  []
---

# 大肥鱼 GPT-SoVITS v2 音色训练（2026-10-25）

## 结论

用 `YinZilu/da-fei-yu-girl-voice-zh`（CC BY-NC 4.0，credit 尹紫鹭幻想社）微调出
「大肥鱼」中文音色，GPT-SoVITS **v2**，32 kHz。交付包在 `D:/AI/dafeiyu/deliver/`
（230.2 MB）与共享目录 `Documents/deepseek-harness/default-workspace/deliver/`。
样本已推送到记忆 git 仓库 `hana-code-tasks` 的 `mnemon-sync` 分支
`samples/daFeiYu/`。

## 训练实际参数

本机只有 AMD RX 7900 GRE，WSL2 与 VirtualMachinePlatform 在 BIOS 和系统功能里
都关着，ROCm 起不来；也没有 CUDA 设备。因此走纯 CPU（Ryzen 9 5950X，
torch 2.7.1+cpu），`is_half=False`：

- s2（SoVITS）：`epochs=8`，`batch_size` 6→**3**（CPU 折半），`fp16_run=False`，
  `text_low_lr_rate=0.4`，`save_every_epoch=1`；66 iter/epoch，约 3.6 s/it，共 32 min。
- s1（GPT）：`epochs=15`，`batch_size` 8→**4**，`precision="32"`，`if_dpo=False`；
  49 batch/epoch，共 33 min。
- 数据：145 条语音 → 194 段（3–10 s，1040.4 s），6 条唱段排除。
- 仓库 commit `b4570b876f5c086819ba84e3215472733c6a7b70`。

## 验收（三句，seed=1234）

| 文件 | 时长 | 文本 CER | 与参考音色余弦 | dBFS | 削波 | 低频嗡声 |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | 4.22 s | 0.000 | 0.761 | -14.6 | 0 | 5.6e-4 |
| 02 | 3.46 s | 0.067 | 0.859 | -14.5 | 0 | 4.5e-4 |
| 03 | 3.34 s | 0.000 | 0.847 | -14.5 | 0 | 6.1e-4 |

三句彼此余弦 0.840 / 0.892 / 0.890。02 的唯一差异是「念得」被 ASR 识别成「念的」，
同音字。ASR 用 funasr `paraformer-zh`，音色用 ERes2NetV2 说话人嵌入。

## 五个必须记住的坑

1. **`TTS(config)` 的配置必须包在 `"custom"` 键里。** 平铺传会被静默忽略、
   回退到官方 `s2G2333k.pth` + `s1bert25hz-5kh` —— 症状是样本能出声但 md5
   和冒烟测试完全一样。判据：看 `Loading VITS weights from …` 那行路径。
2. `1-get-text.py` 在**每条都失败时仍返回 0**，且输出文件已存在时直接跳过。
   必须 `rm -f` 旧产物并核对行数。第一次缺 `onnxruntime` 导致 194 条全失败、
   文件只有 2 字节而 EXIT=0。
3. `s2_train.py` 直接跑不创建 `logs/<exp>/logs_s2_v2` 与 `SoVITS_weights_v2`
   （那是 webui `open1Ba()` 干的活），第一次在 `shutil.move` 存盘时炸。
   `my_save()` 还会在 CWD 留一个 `<timestamp>.pth` 垃圾文件（约 600 MB）。
4. `tts.run()` 是 generator，不能 `sr, audio = tts.run(...)`。
   `resampy` 是推理的隐式依赖（`_resampy_gpu_filter`），`requirements.txt` 里没有。
   `fast_langdetect` 要联网下 `lid.176.bin`（125 MB）到
   `GPT_SoVITS/pretrained_models/fast_langdetect/`，否则 `Cache directory not found`。
5. `s1_train.py` 跑满 epoch 后 `rich` 进度条在重定向输出下收尾抛
   `AttributeError`、进程 exit 1 —— 权重已全部落盘，属假失败。

## 其他

- ONNX 导出成功（`GPT_SoVITS/onnx_export.py` 的 `GptSoVits.export`），
  四个文件共 791 MB，超 400 MB 上限未入包。要先 `pip install onnx`，
  并让 `torch.load` 走 `weights_only=False`；文件里写死的
  `onnx/koharu/koharu_vits.onnx` 是原作者的 debug 路径，别用 `export()` 直接跑。
- 记忆仓库的 `samples/` 下需要 `-text` 的 `.gitattributes`，否则 Windows
  `core.autocrlf=true` 会把 `text.txt` 的 LF 换成 CRLF，md5 对不上。
- 长句（>15 字）容易飘，数据量只有 194 段 / 17 min。调语气换 `ref/ref.wav`
  与对应 `ref.txt` 即可，权重不用重训。
