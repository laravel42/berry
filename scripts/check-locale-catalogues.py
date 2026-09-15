#!/usr/bin/env python3
"""Assert English message catalogues are well-formed, and no extra locales exist.

Berry ships English only. Each namespace is a JSON file under
frontend/messages/en. An empty string would render blank; a non-string leaf
would throw at format time. Extra locale directories would be loaded if the
frontend list drifted, so they are refused here rather than left to rot.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MESSAGES = ROOT / "frontend" / "messages"
LOCALES = ("en",)
NAMESPACES = (
    "common", "settings", "shell", "tasks", "projects", "goals", "reviews", "agents", "runtimes",
    "navigation",
    "issueDetail",
    "issueLists",
    "inbox",
    "agentsChat",
    "workspaceAdmin",
    "areas",
    "organization",
    "approvals",
)
# An ICU argument is `{name}` or `{name, type, ...}`. The name is followed by
# `}` or `,` — plain prose inside a plural branch (`{Its reply is}`) is not an
# argument, and matching it would demand translations carry an English word.
PLACEHOLDER = re.compile(r"\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=[},])")


def flatten(value: object, prefix: str, out: dict[str, str], where: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            flatten(child, f"{prefix}.{key}" if prefix else key, out, where)
    elif isinstance(value, str):
        if not value.strip():
            raise ValueError(f"{where}: {prefix} is empty")
        out[prefix] = value
    else:
        raise ValueError(f"{where}: {prefix} must be a string or an object")


def load(locale: str, namespace: str) -> dict[str, str]:
    path = MESSAGES / locale / f"{namespace}.json"
    if not path.is_file():
        raise ValueError(f"missing catalogue {path.relative_to(ROOT)}")
    out: dict[str, str] = {}
    flatten(json.loads(path.read_text(encoding="utf-8")), "", out, str(path.relative_to(ROOT)))
    return out


def main() -> int:
    problems: list[str] = []
    found = {path.name for path in MESSAGES.iterdir() if path.is_dir()}
    for name in sorted(found - set(LOCALES)):
        problems.append(f"unexpected locale directory messages/{name}")
    for name in LOCALES:
        if name not in found:
            problems.append(f"missing locale directory messages/{name}")
    for namespace in NAMESPACES:
        try:
            english = load("en", namespace)
        except ValueError as error:
            problems.append(str(error))
            continue
        for locale in LOCALES[1:]:
            try:
                other = load(locale, namespace)
            except ValueError as error:
                problems.append(str(error))
                continue
            for key in sorted(english.keys() - other.keys()):
                problems.append(f"{locale}/{namespace}: missing {key}")
            for key in sorted(other.keys() - english.keys()):
                problems.append(f"{locale}/{namespace}: unexpected {key}")
            for key in sorted(english.keys() & other.keys()):
                want = set(PLACEHOLDER.findall(english[key]))
                got = set(PLACEHOLDER.findall(other[key]))
                if want != got:
                    problems.append(
                        f"{locale}/{namespace}: {key} placeholders {sorted(got)} != {sorted(want)}"
                    )
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        return 1
    print(f"locale catalogues: {len(LOCALES)} locale x {len(NAMESPACES)} namespaces")
    return 0


if __name__ == "__main__":
    sys.exit(main())
