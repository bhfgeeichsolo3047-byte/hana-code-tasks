#!/bin/bash
# 重装本地 TTS（Kokoro-82M，中文 zf_xiaobei）。2026-10-26 早上：/root/models 整个没了，重建。
set -x
exec >> /root/models/kokoro-install.log 2>&1
mkdir -p /root/models/kokoro/repo
cd /root/models/kokoro

UV=/root/.dsh/bili-duty/bin/uv
MIRROR="-i https://pypi.tuna.tsinghua.edu.cn/simple"
$UV venv --seed --python 3.12 .venv || $UV venv --seed .venv
VPY=/root/models/kokoro/.venv/bin/python

$UV pip install $MIRROR --python $VPY kokoro-onnx "misaki[zh]" lameenc soundfile

# 模型 + 音色库（官方 kokoro-onnx 的 v1.0 文件）
[ -s kokoro-v1.0.onnx ] || curl -sL -m 900 -o kokoro-v1.0.onnx \
  "https://gh-proxy.com/https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
[ -s voices-v1.0.bin ] || curl -sL -m 300 -o voices-v1.0.bin \
  "https://gh-proxy.com/https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
ls -la kokoro-v1.0.onnx voices-v1.0.bin

echo "=== 自检 ==="
$VPY - <<'PY'
from kokoro_onnx import Kokoro
k = Kokoro('/root/models/kokoro/kokoro-v1.0.onnx', '/root/models/kokoro/voices-v1.0.bin')
print('voices:', [v for v in k.get_voices() if v.startswith('zf') or v.startswith('zm')])
PY
echo "=== 结束 ==="
