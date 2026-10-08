from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..common import EXTENSION_ROOT, ToolError, clip

SKILLS_ROOT = EXTENSION_ROOT / "generation-skills"
BODY_LIMIT = 16_000


def _frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    if not match:
        return {}, text
    fields = {}
    for line in match.group(1).splitlines():
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip()] = value.strip().strip("'\"")
    return fields, text[match.end():]


def _skills(root: Path) -> dict[str, dict[str, Any]]:
    result = {}
    for path in sorted(root.glob("*/SKILL.md")):
        meta, body = _frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        name = meta.get("name") or path.parent.name
        references = sorted(p.stem for p in (path.parent / "references").glob("*.md"))
        result[name] = {"name": name, "description": meta.get("description", ""), "body": body, "dir": path.parent, "references": references}
    return result


def list_skills(root: Path = SKILLS_ROOT) -> list[dict[str, Any]]:
    return [{"name": s["name"], "description": clip(s["description"], 400), "references": s["references"]} for s in _skills(root).values()]


def load_skill(name: str, reference: str = "", root: Path = SKILLS_ROOT) -> dict[str, Any]:
    skill = _skills(root).get(str(name or ""))
    if skill is None:
        raise ToolError("NOT_FOUND", f"没有这个 skill：{name}", available=list(_skills(root)))
    if reference:
        if reference not in skill["references"]:
            raise ToolError("NOT_FOUND", f"{name} 没有这个参考文档：{reference}", available=skill["references"])
        body = (skill["dir"] / "references" / f"{reference}.md").read_text(encoding="utf-8", errors="replace")
        return {"ok": True, "name": name, "reference": reference, "content": clip(body, BODY_LIMIT)}
    return {"ok": True, "name": name, "references": skill["references"], "content": clip(skill["body"], BODY_LIMIT)}
