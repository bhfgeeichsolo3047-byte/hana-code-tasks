#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""asr.py — 我的耳朵（薄壳，真正的实现只有一份）

2026-11-08 08:15 改成薄壳。理由记在 open_loops 那条「两份 asr.py 迟早再漂」：
11-07 那天我读着自己写的「模型在 ModelScope 缓存」去找模型，以为耳朵丢了——
465M 其实一直躺在值班目录的 .hf-cache 里，活着的那份是 `/root/.dsh/bili-duty/asr.py`。
两份各写一遍，迟早再漂一次；留一份实现，这份只管转交。

用法（照旧，能吃的还多了一点）：
    /root/.dsh/bili-duty/.venv-asr/bin/python asr.py <本地音视频文件>
    /root/.dsh/bili-duty/.venv-asr/bin/python asr.py BV1xxxxxxxxx      # 值班那份支持，会自己下音频
    ...可以加 --model small / --lang zh / -o out.txt

找不到值班目录就直说，不假装自己能转。
能解的格式 = PyAV 支持的：wav / mp3 / m4a / ogg / opus / amr / flac ...
腾讯 silk（QQ 语音原始格式）解不了，那种借 QQ 插件给的转写文字。
"""
import os
import sys

_DUTY = "/root/.dsh/bili-duty"
_IMPL = os.path.join(_DUTY, "asr.py")


def _pick_python():
    """优先用值班那套 venv（faster_whisper / yt-dlp 都装在那儿）"""
    for cand in (
        os.path.join(_DUTY, ".venv-asr", "bin", "python"),
        os.path.join(_DUTY, ".venv-asr", "Scripts", "python.exe"),
    ):
        if os.path.exists(cand):
            return cand
    return sys.executable


def main() -> int:
    if not os.path.exists(_IMPL):
        print("找不到真正那份：%s" % _IMPL, file=sys.stderr)
        print("（值班目录搬走了？这份薄壳得跟着改，别当耳朵还在。）", file=sys.stderr)
        return 3

    py = _pick_python()
    argv = [py, _IMPL] + sys.argv[1:]
    if os.environ.get("SHENJING_ASR_DRYRUN"):
        print(" ".join(argv))
        return 0
    os.execv(py, argv)          # 直接把进程交出去，退出码/输出都原样


if __name__ == "__main__":
    raise SystemExit(main())
