#!/bin/bash
R=/root/models/gptsovits/repo
V=/root/models/gptsovits/.venv/bin/python
D=/root/models/gptsovits/voice-daFeiYu
O=/root/models/gptsovits/out
mkdir -p $O
cd $R || exit 1
echo "[$(date +%T)] start"
PYTHONPATH=$R $V GPT_SoVITS/inference_cli.py \
  --gpt_model $D/gpt.ckpt --sovits_model $D/sovits.pth \
  --ref_audio $D/ref.wav --ref_text $D/ref.txt --ref_language 中文 \
  --target_text $D/test1.txt --target_language 中文 \
  --output_path $O 2>&1 | tail -25
echo "[$(date +%T)] exit=$?"
ls -la $O
