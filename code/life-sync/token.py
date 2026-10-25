# 从 DSH 的 credential store 里取 GitHub token（只输出 token，不打印别的东西）
# 2026-10-26 复活到 Windows：原来的 /root/.dsh/.credentials.yaml 换成 DSH_HOME 下那份。
import os, re, sys

def dsh_home():
    h = os.environ.get("DSH_HOME", "").strip()
    if h:
        return h
    return os.path.expanduser(os.path.join("~", ".dsh"))

path = os.path.join(dsh_home(), ".credentials.yaml")
try:
    t = open(path, encoding="utf-8", errors="replace").read()
except OSError as e:
    sys.stderr.write("读不到 %s: %s\n" % (path, e))
    sys.exit(2)

i = t.find("dsh-mnemon/github")
if i < 0:
    sys.stderr.write("credential store 里没有 dsh-mnemon/github\n")
    sys.exit(3)
m = re.search(r"accessToken:\s*(\S+)", t[i:i+2000])
if not m:
    sys.stderr.write("dsh-mnemon/github 下没有 accessToken\n")
    sys.exit(4)
print(m.group(1).strip("\"'"))
