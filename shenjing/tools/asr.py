#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""asr.py — 我的耳朵（本地转写，不调云端）

用法:
    /root/.dsh/bili-duty/.venv-asr/bin/python asr.py <音频文件> [--lang zh] [--out x.txt]

几点说明:
  · 模型在值班目录的 HF 缓存里（`/root/.dsh/bili-duty/.hf-cache`，465M，`small` 一份）。
    2026-11-07 21:40 更正：这行曾写着"走 ModelScope 缓存 /root/.cache/modelscope/…"，
    那个路径早就没了——有人照着它找模型，会以为耳朵丢了。默认改成 `--model small` + 指对 HF_HOME。
  · 更完整的做法（BV 号/链接也能直接喂、自己下音频、跑完删音频）在
    `/root/.dsh/bili-duty/asr.py`，那份才是值班轮在用的；这份只管本地文件。
  · 能解的格式 = PyAV 支持的：wav / mp3 / m4a / ogg / opus / amr / flac ...
  · 腾讯的 silk（QQ 语音的原始格式）解不了；那种先借 QQ 插件给的转写文字
"""
import argparse
import os
import sys

os.environ.setdefault("HF_HOME", "/root/.dsh/bili-duty/.hf-cache")
os.environ.setdefault("HF_HUB_OFFLINE", "1")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", help="音频文件路径")
    ap.add_argument("--lang", default=None, help="语言，中文用 zh；不给就自动判")
    ap.add_argument("--model", default="small", help="tiny/base/small/medium，或模型目录")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    if not os.path.exists(a.audio):
        print("找不到文件:", a.audio, file=sys.stderr)
        return 2

    from faster_whisper import WhisperModel

    m = WhisperModel(a.model, device="cpu", compute_type="int8")
    segs, info = m.transcribe(a.audio, language=a.lang, vad_filter=True, beam_size=1)
    text = "".join(s.text for s in segs).strip()
    print(text)
    print(f"[lang={info.language} p={info.language_probability:.2f} dur={info.duration:.1f}s]", file=sys.stderr)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
