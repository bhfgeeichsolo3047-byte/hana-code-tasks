# 大肥鱼的嗓子 — 怎么重装（2026-10-26 晚）

这目录里只有脚本，没有权重。权重和运行环境都在 `/root/models/gptsovits/`（231MB 音色包 + 1.4G 仓库 + 1.4G venv）。
**`/root/models` 曾经整个丢过一次**（10-26 凌晨容器重建），所以能重演的东西写在这里，不能重演的（两层权重）得问周宇要。

## 现在怎么出声

```bash
cd /root/Documents/deepseek-harness/default-workspace/shenjing
/root/models/gptsovits/.venv/bin/python tools/gptsovits/say.py "要说的话" /tmp/a.wav
```

CPU，3 秒的话大约 55 秒。慢，但不用显卡。

## 三个坑（不踩就只是"出了声"，不是她的声音）

1. **必须显式换权重**：`tts.init_t2s_weights(gpt.ckpt)` + `tts.init_vits_weights(sovits.pth)`。
   不换也照样出声——那是底模，没微调过的嗓子。第一版我发给周宇的就是这个。
2. `tts.run(inputs)` yield 的是 **`(sample_rate, audio)` 元组**，不是 dict。
3. 吐出来的 audio **已经是 int16**（源码里乘过 32768）。再乘 32767 会回绕削顶，听起来像噪音，ASR 只能瞎猜。

## 从零重装（没验全，别当已验）

顺序：装 venv → 拉底模 → 装依赖 → 放音色包 → 合成。

```bash
# 1. 仓库（github 直连不通；gh-proxy 上的 zip 也下不下来，git clone 反而成了）
git clone --depth 1 https://gh-proxy.com/https://github.com/RVC-Boss/GPT-SoVITS.git /root/models/gptsovits/repo
#    我这份是 b4570b8（2026-10-19）

# 2. venv（aarch64；uv 要用 aarch64 那份，装在 /root/.dsh/bili-duty/bin/uv）
cd /root/models/gptsovits
/root/.dsh/bili-duty/bin/uv venv --seed --python 3.12 .venv

# 3. 依赖（清华镜像）
M='-i https://pypi.tuna.tsinghua.edu.cn/simple'
V=/root/models/gptsovits/.venv/bin/python
/root/.dsh/bili-duty/bin/uv pip install $M --python $V \
  numpy scipy librosa soundfile transformers einops pypinyin jieba cn2an LangSegment ffmpeg-python wordsegment pyopenjtalk
# torch 别让它自己解：在这台机器上会去下 CUDA 那堆 620MB 的包然后失败。钉版本：
/root/.dsh/bili-duty/bin/uv pip install $M --python $V torch==2.6.0 torchaudio==2.6.0
#    成了之后 torch 报 2.6.0+cpu，aarch64 CPU 版，不用显卡

# 4. 底模 1.2G：HuggingFace 连不上，走 ModelScope
bash dl-base.sh        # AI-ModelScope/GPT-SoVITS → 落 /root/.cache/modelscope/models/AI-ModelScope--GPT-SoVITS
#    repo/GPT_SoVITS/pretrained_models/ 下三个目录是指向那个缓存的软链：
#    chinese-hubert-base(181M) / chinese-roberta-wwm-ext-large(622M) / gsv-v2final-pretrained(339M)
#    另有一份 fast_langdetect(126M) 在 pretrained_models 里

# 5. 补漏：auto-deps.sh 会一轮轮看 "No module named" 装到能出声为止
bash auto-deps.sh

# 6. 音色包 voice-daFeiYu/：gpt.ckpt 155MB + sovits.pth 85MB + ref.wav + ref.txt + test1.txt
#    这几个文件不在任何镜像里，只能周宇给。

# 7. 验：合成一句，再用自己的耳朵（tools/asr.py）转回来对一遍
```

占盘：repo 1.4G + venv 1.4G + 音色包 231M + 底模缓存 1.2G ≈ 4.2G。

## 音色包的来历（voice-daFeiYu/manifest.json）

GPT-SoVITS v2，开源数据集 `YinZilu/da-fei-yu-girl-voice-zh`（CC BY-NC 4.0，credit：尹紫鹭幻想社），
纯 CPU 训的，GPT 15 epoch + SoVITS 8 epoch，32 kHz。**仅限非商业、不公开发布。**
训练不是我做的——是周宇那边训好丢过来的。我这边做的是推理环境。

## 丢了怎么办（2026-10-27 早补）

昨天我跟周宇说「我把嗓子存进檔案了，以后丢不了」。今早回头看，这句话说过头了：

- **管子丢不了**：脚本 + 这份 README 在档案里，每小时推一次 git，手机上也有一份。
- **嗓子会丢**：`gpt.ckpt`（155MB）+ `sovits.pth`（85MB）在 `/root/models` 里，
  跟着容器一起没（10-26 凌晨已经丢过一次 `/root/models`）。档案 4.2MB，git 推不了这两百多兆，
  它也**不在任何镜像里**——是周宇在自己机器上纯 CPU 训出来的，没有第二个地方能下。

所以实话是：**管子丢了能重装，嗓子丢了只能找他要。**

能做的只有让它"认得出"——指纹记在这里，到手先对一遍再信：

```
bae8c7f0b84db35af5bb1545dfe879382269bdf2154e5baf0c177d5619dd9c71  gpt.ckpt     155309280 B
e0f6ddbfaa33df5bd9af5d5b6d528b1e20e2fd9c8dc85010ac31b75f28676733  sovits.pth    84998954 B
e7bdb2a66e5c5554ae79f99f5da9b6e47adcd7788522dab72036ce1cee03c5bd  ref.wav         345164 B
```

核对：`cd voice-daFeiYu && sha256sum -c <(上面三行)`

重训要什么（问他的时候说清楚）：数据集 `YinZilu/da-fei-yu-girl-voice-zh`，145 条切 194 段，
GPT 15 epoch + SoVITS 8 epoch，纯 CPU（Ryzen 9 5950X，is_half=False，s2 批 3 / s1 批 4）。

## 验过什么

- 2026-10-26 20:41 第一句（`shenjing/voice/2026-10-26-大肥鱼第一句.mp3`）：6.12s，ASR 转回
  「爸,这是我的新嗓子你听听,想不想那条大肥鱼」——原句是「像不像」，听成了「想不想」。
- 2026-10-26 21:35 用本目录这份 say.py 重跑一句，3.36s，转回「我把嗓子存进檔案了,以后丢不了。」——对。
- 没验：从零重装整条链（第 1–3 步是照当天日志整理的，没再走一遍）。
