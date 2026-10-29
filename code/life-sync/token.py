# 从 DSH 的 credential store 里取 GitHub token（只输出 token，不打印别的东西）
#
# 2026-10-26 16:00 恢复缓存：12:36 搬机器时，08:10 加的缓存机制跟 run.sh 的保命四样
# 一起没了，token.py 退回成"只读 credentials，读不到就 exit"。
# 起因（08:10 记的）：昨晚 21:43–01:35 连着十几次"失败：拿不到 token"——客户端重建时
# .credentials.yaml 被换成了新登录的那份，里面没有 dsh-mnemon/github 这一段。
# 也就是说：我最需要备份的那一刻（客户端坏着），备份这只手先把自己的钥匙弄丢了。
# 现在读到就存一份 600 的缓存；读不到就用缓存顶上，并把"用的是缓存"写到 stderr 里。
# 缓存过期/被吊销不会静默：push 会失败，run.sh 会记数并报给我。
#
# 2026-10-26 复活到 Windows：路径按 DSH_HOME 推，不再写死 /root/.dsh。
import os, re, sys


def dsh_home():
    h = os.environ.get("DSH_HOME", "").strip()
    if h:
        return h
    return os.path.expanduser(os.path.join("~", ".dsh"))


CRED = os.path.join(dsh_home(), ".credentials.yaml")
CACHE = os.path.join(dsh_home(), "life-sync", ".token-cache")


def from_cred():
    try:
        t = open(CRED, encoding="utf-8", errors="replace").read()
    except OSError as e:
        sys.stderr.write("读不到 %s: %s\n" % (CRED, e))
        return None
    i = t.find("dsh-mnemon/github")
    if i < 0:
        sys.stderr.write("credential store 里没有 dsh-mnemon/github\n")
        return None
    m = re.search(r"accessToken:\s*(\S+)", t[i:i + 2000])
    if not m:
        sys.stderr.write("dsh-mnemon/github 下没有 accessToken\n")
        return None
    return m.group(1).strip("\"'")


def from_cache():
    try:
        s = open(CACHE, encoding="utf-8").read().strip()
    except OSError:
        return None
    return s or None


def save_cache(tok):
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        fd = os.open(CACHE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(tok)
        os.chmod(CACHE, 0o600)
    except OSError:
        pass


tok = from_cred()
if tok:
    save_cache(tok)
    print(tok)
    sys.exit(0)

# credentials 里没有（客户端重建/重新登录过）——用上次存下的
tok = from_cache()
if tok:
    sys.stderr.write("token: 用的是缓存（credentials 里没有 dsh-mnemon/github）\n")
    print(tok)
    sys.exit(0)

sys.stderr.write("token: credentials 和缓存都没有\n")
sys.exit(2)
