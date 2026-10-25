# 从 mnemon 的 GitHub 授权记录里取 token（只输出 token，不打印别的东西）
import re, sys
t = open("/root/.dsh/.credentials.yaml", encoding="utf-8", errors="replace").read()
i = t.find("dsh-mnemon/github")
if i < 0:
    sys.exit(2)
m = re.search(r"accessToken:\s*(\S+)", t[i:i+2000])
if not m:
    sys.exit(3)
print(m.group(1).strip("\"'"))
