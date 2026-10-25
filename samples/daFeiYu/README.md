# daFeiYu 音色样本（GPT-SoVITS v2）

2026-10-25 训出的「大肥鱼」音色，GPT-SoVITS v2，32 kHz，纯 CPU 训练。
数据集 `YinZilu/da-fei-yu-girl-voice-zh`（CC BY-NC 4.0，credit 尹紫鹭幻想社），
仅限非商业使用。

## 文件

| 文件 | 说明 |
| --- | --- |
| `01.wav` | 我在听，海面上今天没什么风。 |
| `02.wav` | 这一句是用来试音色的，念得慢一点。 |
| `03.wav` | 如果你听得清楚，说明模型是好的。 |
| `text.txt` | 每行 `文件名\|台词` |
| `report.json` | ASR / 说话人余弦 / 信号指标 |
| `manifest.json` | 权重元数据（epoch、commit、授权） |

## 客观验收

| 文件 | 时长 | 文本 CER | 与参考音色余弦 | dBFS | 削波 | 低频嗡声 |
| --- | --- | --- | --- | --- | --- | --- |
| 01.wav | 4.22 s | 0.000 | 0.761 | -14.6 | 0 | 5.6e-4 |
| 02.wav | 3.46 s | 0.067 | 0.859 | -14.5 | 0 | 4.5e-4 |
| 03.wav | 3.34 s | 0.000 | 0.847 | -14.5 | 0 | 6.1e-4 |

三句彼此余弦 0.840 / 0.892 / 0.890 —— 同一音色。02 的唯一差异是「念得」被
ASR 识别成「念的」，同音字。

权重（`sovits.pth` 85 MB + `gpt.ckpt` 155 MB）体积过大，未入此仓库，
见本机 `D:/AI/dafeiyu/deliver/` 或共享目录
`Documents/deepseek-harness/default-workspace/deliver/`。
