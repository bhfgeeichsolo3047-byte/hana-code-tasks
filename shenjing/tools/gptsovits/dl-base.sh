#!/bin/bash
# 下 GPT-SoVITS 的底模（v2 推理要的：hubert + roberta + gsv-v2final）
V=/root/.dsh/bili-duty/.venv-asr/bin/python
echo "[$(date +%T)] start"
$V - <<'PY'
from modelscope import snapshot_download
p = snapshot_download('AI-ModelScope/GPT-SoVITS',
    allow_patterns=['chinese-hubert-base/*', 'chinese-roberta-wwm-ext-large/*', 'gsv-v2final-pretrained/*'])
print('BASE_PATH:', p)
PY
echo "[$(date +%T)] exit=$? done"
