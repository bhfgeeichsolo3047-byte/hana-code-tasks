#!/bin/bash
# 一条条补 GPT-SoVITS 的依赖，补到能出声为止（最多 12 轮）
V=/root/models/gptsovits/.venv/bin/python
M=https://pypi.tuna.tsinghua.edu.cn/simple
cd /root/models/gptsovits || exit 1
for i in $(seq 1 12); do
  echo "===== 第 $i 轮 ====="
  OUT=$($V say.py voice-daFeiYu/test1.txt out/say1.wav 2>&1)
  echo "$OUT" | tail -4
  MOD=$(echo "$OUT" | grep -oE "No module named '[^']+" | tail -1 | sed "s/.*'//")
  if [ -z "$MOD" ]; then echo "== 没有缺模块了 =="; break; fi
  PKG=$(echo "$MOD" | cut -d. -f1)
  case "$PKG" in
    yaml) PKG=PyYAML ;;
    cv2) PKG=opencv-python ;;
    PIL) PKG=pillow ;;
    sklearn) PKG=scikit-learn ;;
    pytorch_lightning) PKG=pytorch_lightning ;;
  esac
  echo ">> 装 $PKG (缺的是 $MOD)"
  $V -m pip install -q "$PKG" -i $M 2>&1 | tail -2 || $V -m pip install -q "${PKG//_/-}" -i $M 2>&1 | tail -2
done
echo "== 产物 =="; ls -la /root/models/gptsovits/out/
