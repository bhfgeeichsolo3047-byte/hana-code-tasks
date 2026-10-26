#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""say.py — 用「大肥鱼」的音色把一段文字说成 wav。

    /root/models/gptsovits/.venv/bin/python tools/gptsovits/say.py "要说的字" /tmp/a.wav
    /root/models/gptsovits/.venv/bin/python tools/gptsovits/say.py 话.txt /tmp/a.wav

第一个参数是文件就当场读，不是文件就当成要念的字。
模型目录默认 /root/models/gptsovits，可用 MODEL_HOME 改。

绕开 inference_webui（要 gradio），直接走 TTS_infer_pack。三个坑（2026-10-26 晚上踩的）：
  1. 不显式 init_t2s_weights / init_vits_weights，跑的是底模——没微调过的嗓子，照样出声。
  2. TTS.run() yield 的是 (sample_rate, audio) 元组，不是 dict。
  3. 吐出来的 audio 已经是 int16；再乘 32767 会回绕削顶，听起来像噪音。
重建步骤见同目录 README.md。
"""
import os
import sys
import wave

H = os.environ.get("MODEL_HOME", "/root/models/gptsovits")
R = os.path.join(H, "repo")
D = os.path.join(H, "voice-daFeiYu")

if not os.path.isdir(R) or not os.path.isdir(D):
    sys.exit(f"模型不在：{R} 或 {D}（见 tools/gptsovits/README.md 的重建步骤）")

sys.path.insert(0, R)
sys.path.insert(0, os.path.join(R, "GPT_SoVITS"))
os.chdir(R)

from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

arg = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, "test1.txt")
out_wav = sys.argv[2] if len(sys.argv) > 2 else os.path.join(H, "out", "say.wav")
if os.path.isfile(arg):
    text = open(arg, encoding="utf-8").read().strip()
else:
    text = arg.strip()
if not text:
    sys.exit("没字可念")
os.makedirs(os.path.dirname(os.path.abspath(out_wav)), exist_ok=True)

cfg = TTS_Config({
    "device": "cpu", "is_half": False, "version": "v2",
    "t2s_weights_path": f"{D}/gpt.ckpt",
    "vits_weights_path": f"{D}/sovits.pth",
    "cnhuhbert_base_path": "GPT_SoVITS/pretrained_models/chinese-hubert-base",
    "bert_base_path": "GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large",
})
print("loading tts...", flush=True)
tts = TTS(cfg)
print("loading fine-tuned weights...", flush=True)
tts.init_t2s_weights(f"{D}/gpt.ckpt")
tts.init_vits_weights(f"{D}/sovits.pth")

inputs = {
    "text": text,
    "text_lang": "zh",
    "ref_audio_path": f"{D}/ref.wav",
    "prompt_text": open(os.path.join(D, "ref.txt"), encoding="utf-8").read().strip(),
    "prompt_lang": "zh",
    "text_split_method": "cut5",
    "batch_size": 1,
    "speed_factor": 1.0,
}

print("inferring...", flush=True)
import numpy as np  # noqa: E402

n = 0
for item in tts.run(inputs):
    sr, audio = (item[0], item[1]) if isinstance(item, (tuple, list)) else (item["sample_rate"], item["audio"])
    p = out_wav if n == 0 else out_wav.replace(".wav", f"_{n}.wav")
    arr = np.asarray(audio)
    frames = arr.tobytes() if arr.dtype == np.int16 else (np.clip(arr, -1, 1) * 32767).astype("int16").tobytes()
    with wave.open(p, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(frames)
    print("WROTE", p, f"{len(arr) / sr:.2f}s", flush=True)
    n += 1
print("done", flush=True)
