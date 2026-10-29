#!/bin/bash
V=/root/models/gptsovits/.venv/bin/python
M=https://pypi.tuna.tsinghua.edu.cn/simple
echo "[$(date +%T)] 补依赖"
$V -m pip install -q psutil ffmpeg-python soundfile librosa transformers jieba wordsegment cn2an pypinyin LangSegment g2p_en -i $M 2>&1 | tail -3
echo "[$(date +%T)] 依赖装完，跑合成"
bash /root/models/gptsovits/infer-once.sh
echo "[$(date +%T)] all done"
