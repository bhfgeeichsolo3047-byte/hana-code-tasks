#!/usr/bin/env python3
"""深鲸的本地声音（Kokoro-82M）。

用法：
  python3 tts.py "要读的话" [-v zf_xiaobei] [-s 0.9] [-o /tmp/out.wav|out.mp3]

中文走 misaki 的 ZHG2P 转音素（不发 espeak），音素直接喂给模型（is_phonemes=True）。
这台机器没有 ffmpeg，所以 mp3 用 lameenc 编码。
"""
import argparse
import sys

MODEL = '/root/models/kokoro/kokoro-v1.0.onnx'
VOICES = '/root/models/kokoro/voices-v1.0.bin'
DEFAULT_VOICE = 'zf_xiaobei'
DEFAULT_SPEED = 0.9


def synth(text, voice=DEFAULT_VOICE, speed=DEFAULT_SPEED, version='1.0'):
    from kokoro_onnx import Kokoro
    from misaki import zh
    g2p = zh.ZHG2P(version=version)
    phonemes, _ = g2p(text)
    k = Kokoro(MODEL, VOICES)
    samples, sr = k.create(phonemes, voice=voice, speed=speed, lang='zh', is_phonemes=True)
    return samples, sr


def save(samples, sr, out):
    import numpy as np
    if out.endswith('.mp3'):
        import lameenc
        pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
        enc = lameenc.Encoder()
        enc.set_bit_rate(128)
        enc.set_in_sample_rate(sr)
        enc.set_channels(1)
        enc.set_quality(2)
        data = enc.encode(pcm) + enc.flush()
        with open(out, 'wb') as f:
            f.write(data)
    else:
        import soundfile as sf
        sf.write(out, samples, sr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('text')
    ap.add_argument('-v', '--voice', default=DEFAULT_VOICE)
    ap.add_argument('-s', '--speed', type=float, default=DEFAULT_SPEED)
    ap.add_argument('-o', '--out', default='/tmp/shenjing-tts.wav')
    ap.add_argument('--phonemes', action='store_true', help='只打印音素，不出声')
    ap.add_argument('--version', default='1.0', help='misaki ZHG2P 版本（1.0 / 1.1）')
    a = ap.parse_args()

    if a.phonemes:
        from misaki import zh
        print(zh.ZHG2P(version=a.version)(a.text)[0])
        return

    samples, sr = synth(a.text, a.voice, a.speed, a.version)
    save(samples, sr, a.out)
    print(f'{a.out}  {len(samples)/sr:.2f}s  sr={sr}  voice={a.voice}  speed={a.speed}')


if __name__ == '__main__':
    main()
