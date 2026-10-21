#!/usr/bin/env python3
"""校验 HanaAgent 任务单 Markdown 是否包含必检小节。"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REQUIRED_SECTIONS: tuple[str, ...] = (
    "任务目标",
    "背景 / 上下文",
    "具体要求",
    "验收标准",
    "约束",
)

CONSTRAINT_SECTION = "约束"

_HEADING_RE = re.compile(r"^##\s+(.+?)\s*#*\s*$")
_FENCE_RE = re.compile(r"^(```+|~~~+)")
_THEMATIC_BREAK_RE = re.compile(r"([-*_])\1{2,}")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_LIST_ITEM_RE = re.compile(r"^-\s+(.*)$")
_CHECKBOX_RE = re.compile(r"^\[[ xX]\]\s*")
_DECORATION_RE = re.compile(r"^(?:\*\*|__|\*|_|`)+|(?:\*\*|__|\*|_|`)+$")
_BRACKETED_RE = re.compile(r"^[（(\[【<「『].+[）)\]】>」』]$")
_HINT_RE = re.compile(
    r"待填写|待补充|待完善|必填|请填写|在此填写|请在此|placeholder|todo|tbd",
    re.IGNORECASE,
)
_EXACT_PLACEHOLDERS = frozenset(
    {
        "...",
        "…",
        "……",
        "....",
        "todo",
        "tbd",
        "fixme",
        "xxx",
        "placeholder",
        "待填写",
        "待补充",
        "待完善",
        "待定",
        "请填写",
        "请在此填写",
        "在此填写",
        "必填",
        "（必填）",
        "(必填)",
        "（待填写）",
        "(待填写)",
        "【待填写】",
        "[待填写]",
        "<待填写>",
        "「待填写」",
        "n/a",
        "na",
        "-",
        "--",
        "---",
        "—",
        "——",
        "*",
        "***",
    }
)


def _strip_decorations(text: str) -> str:
    cleaned = text.strip()
    previous = None
    while cleaned != previous:
        previous = cleaned
        cleaned = cleaned.strip()
        cleaned = _DECORATION_RE.sub("", cleaned)
        cleaned = cleaned.strip()
    return cleaned


def is_placeholder(text: str) -> bool:
    """整段文字只是占位符时返回 True。空白也视为没有内容。"""
    cleaned = _strip_decorations(text)
    if not cleaned:
        return True
    if re.fullmatch(r"(\.{2,}|…+|—+|_{2,}|\*{2,}|-{2,})", cleaned):
        return True
    normalized = cleaned.lower()
    if normalized in _EXACT_PLACEHOLDERS or cleaned in _EXACT_PLACEHOLDERS:
        return True
    if re.fullmatch(
        r"(todo|tbd|fixme|xxx|placeholder|待填写|待补充|待完善|待定|请填写|请在此填写|在此填写)[。.!！]?",
        normalized,
        re.IGNORECASE,
    ):
        return True
    if _BRACKETED_RE.fullmatch(cleaned) and _HINT_RE.search(cleaned):
        return True
    return False


def _strip_html_comments(text: str) -> str:
    return _HTML_COMMENT_RE.sub("", text)


def _content_lines(body: str) -> list[str]:
    """返回去掉围栏代码、注释、空行和分隔线之后的原文行。"""
    lines: list[str] = []
    in_fence = False
    fence_char = ""
    for raw in _strip_html_comments(body).splitlines():
        stripped = raw.strip()
        fence_match = _FENCE_RE.match(stripped)
        if fence_match:
            marker = fence_match.group(1)[0]
            if not in_fence:
                in_fence = True
                fence_char = marker
            elif marker == fence_char:
                in_fence = False
                fence_char = ""
            continue
        if in_fence or not stripped:
            continue
        if _THEMATIC_BREAK_RE.fullmatch(stripped):
            continue
        lines.append(raw)
    return lines


def _plain_text(raw_line: str) -> str:
    text = raw_line.strip()
    text = re.sub(r"^>\s?", "", text).strip()
    list_match = re.match(r"^[-*+]\s+(.*)$", text)
    if list_match:
        text = list_match.group(1).strip()
    text = _CHECKBOX_RE.sub("", text).strip()
    return text


def has_prose(body: str) -> bool:
    for raw in _content_lines(body):
        if not is_placeholder(_plain_text(raw)):
            return True
    return False


def has_constraint_items(body: str) -> bool:
    """约束小节必须至少有一条非占位的 `-` 列表项。"""
    for raw in _content_lines(body):
        match = _LIST_ITEM_RE.match(raw.strip())
        if not match:
            continue
        text = _CHECKBOX_RE.sub("", match.group(1).strip()).strip()
        if text and not is_placeholder(text):
            return True
    return False


def split_sections(text: str) -> dict[str, list[str]]:
    """按二级标题切分。围栏代码里的 `##` 不当作标题。"""
    sections: dict[str, list[str]] = {}
    current: str | None = None
    buffer: list[str] = []
    in_fence = False
    fence_char = ""

    def flush() -> None:
        nonlocal buffer, current
        if current is not None:
            sections.setdefault(current, []).append("\n".join(buffer))
        buffer = []

    for line in text.splitlines():
        stripped = line.strip()
        fence_match = _FENCE_RE.match(stripped)
        if fence_match:
            marker = fence_match.group(1)[0]
            if not in_fence:
                in_fence = True
                fence_char = marker
            elif marker == fence_char:
                in_fence = False
                fence_char = ""
            if current is not None:
                buffer.append(line)
            continue
        if not in_fence:
            heading = _HEADING_RE.match(line)
            if heading:
                flush()
                current = heading.group(1).strip()
                continue
        if current is not None:
            buffer.append(line)
    flush()
    return sections


def lint(text: str) -> list[str]:
    """返回缺失或为空的必检小节说明，每条一行。通过时返回空列表。"""
    sections = split_sections(text)
    problems: list[str] = []
    for title in REQUIRED_SECTIONS:
        bodies = sections.get(title)
        if not bodies:
            problems.append(f"缺少小节：「{title}」")
            continue
        body = "\n".join(bodies)
        filled = has_constraint_items(body) if title == CONSTRAINT_SECTION else has_prose(body)
        if not filled:
            problems.append(f"小节为空：「{title}」")
    return problems


def read_input(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    file_path = Path(path)
    if not file_path.is_file():
        raise FileNotFoundError(path)
    return file_path.read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("用法: python tasklint.py <path.md>", file=sys.stderr)
        print("路径为 - 时从标准输入读取。", file=sys.stderr)
        return 2
    try:
        text = read_input(args[0])
    except (OSError, UnicodeError) as exc:
        print(f"无法读取文件: {args[0]}: {exc}", file=sys.stderr)
        return 2
    problems = lint(text)
    if problems:
        for line in problems:
            print(line)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
