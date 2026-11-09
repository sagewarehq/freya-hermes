"""Talaria → Freya on this server: ``/freya migrate`` (``--check`` only counts). The phone runs it once, as a step of
its "Talaria is now Freya" move, after freya has replaced the talaria plugin. Safe to run again: whatever is done
already is left alone.

What it does, in Hermes's root (one set for every profile, as ``store.home``):

- **The data folder.** ``talaria/`` (apps, their databases and actions, the workspace, phones, pages) becomes
  ``freya/``, and ``talaria`` stays behind as a link to it. The link stays for good: the starters' venvs carry their
  absolute path in their scripts and ``pyvenv.cfg``, and old replies, routines and notes name ``talaria/`` paths.
  Until this runs, ``freya`` is the link instead (``store.data_home``), so nothing ever goes missing.
- **Old names in what Hermes and its apps read.** ``~/.hermes/plugins/talaria/`` stops existing when the talaria
  plugin is removed, and it can't be a link (Hermes would load it as a second plugin), so ``python3
  ~/.hermes/plugins/talaria/build.py`` in an app's scripts or in Hermes's memory would break. Rewritten, in the
  apps' sources and scripts (not built bundles, databases or ``node_modules``) and in Hermes's memory notes:
  ``plugins/talaria/`` → ``plugins/freya/``, ``.hermes/talaria`` → ``.hermes/freya``, ``/talaria:app`` →
  ``/freya:app`` (and ``routine``). Imports of ``'talaria'`` stay: both names resolve.

Routines are Hermes's cron jobs: the phone rewrites them through Hermes's own API, so they're not touched here.
"""
from __future__ import annotations

import fcntl
import os
import re
from pathlib import Path

RULES = [
    (re.compile(r"(\.hermes(?:/profiles/[^/\s'\"]+)?/plugins/)talaria\b"), r"\1freya"),
    (re.compile(r"\.hermes/talaria\b"), ".hermes/freya"),
    (re.compile(r"(?<![\w-])/?talaria:(app|routine)\b"), lambda m: m.group(0).replace("talaria:", "freya:")),
]
# Imports stay: `from 'talaria'` and `from 'freya'` both resolve, and the dev server's copy of talaria/apps.mjs in a
# workspace only learns 'freya' at the next build, so an app served live would break if it were rewritten first.
TEXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".md", ".json", ".sh", ".txt", ".css", ".html", ".sql",
        ".yaml", ".yml", ".toml"}
SKIP_DIRS = {"node_modules", "dist", ".vite", "venvs", "__pycache__", ".git", "assets"}


def rewrite(text: str) -> str:
    for pattern, replacement in RULES:
        text = pattern.sub(replacement, text)
    return text


def _sources(data: Path) -> list[Path]:
    """The files people and Hermes wrote: app sources and scripts. Built apps (``apps/<name>/`` pages and bundles)
    are left as they are, apart from their scripts, notes and SQL."""
    out: list[Path] = []
    ws = data / "workspace" / "apps"
    if ws.is_dir():
        out += [p for p in ws.rglob("*") if p.is_file() and p.suffix in TEXT and not SKIP_DIRS & set(p.parts)]
    apps = data / "apps"
    if apps.is_dir():
        for app in apps.iterdir():
            if not app.is_dir():
                continue
            out += [p for p in app.glob("*") if p.is_file() and p.suffix in {".py", ".md", ".sh", ".sql", ".toml"}]
            if (app / "actions").is_dir():
                out += [p for p in (app / "actions").rglob("*") if p.is_file() and p.suffix in TEXT
                        and not SKIP_DIRS & set(p.parts)]
    return out


def _memories(root: Path) -> list[Path]:
    """Hermes's memory notes, the root's and each profile's (``<home>/memories/*.md``)."""
    homes = [root] + sorted((root / "profiles").glob("*")) if (root / "profiles").is_dir() else [root]
    return [p for h in homes for p in sorted((h / "memories").glob("*.md")) if p.is_file()]


def _stale(paths: list[Path]) -> list[Path]:
    stale = []
    for p in paths:
        try:
            text = p.read_text()
        except (OSError, UnicodeDecodeError):
            continue
        if rewrite(text) != text:
            stale.append(p)
    return stale


def data_moved(root: Path) -> bool:
    """``freya/`` is the real folder (or there's no talaria data at all)."""
    old = root / "talaria"
    return old.is_symlink() or not old.is_dir()


def check(root: Path, data: Path) -> dict:
    apps = data / "apps"
    files, memories = _stale(_sources(data)), _stale(_memories(root))
    return {
        "pending": not data_moved(root) or bool(files) or bool(memories),
        "data": "freya" if data_moved(root) else "talaria",
        "apps": sum(1 for a in apps.iterdir() if (a / "index.html").exists()) if apps.is_dir() else 0,
        "files": len(files),
        "memories": len(memories),
    }


def move_data(root: Path) -> None:
    """``talaria/`` → ``freya/``, leaving ``talaria`` as a link to it. Another backend may call ``data_home`` meanwhile
    and put the ``freya`` link back: the move then tries again. Files open in other processes (the attention
    store's WAL, a running apps server) keep working through the move, and their old paths through the link."""
    new, old = root / "freya", root / "talaria"
    if data_moved(root):
        return
    for _ in range(10):
        if new.is_symlink():
            new.unlink()
        elif new.exists():
            raise RuntimeError(f"{new} and {old} are both folders; move what's in {old} by hand.")
        try:
            os.rename(old, new)
            break
        except OSError:
            continue  # the link came back: again
    else:
        raise RuntimeError(f"Couldn't move {old} to {new}; try again.")
    link = root / ".talaria-link"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to("freya", target_is_directory=True)
    try:
        os.replace(link, old)  # in one step: there's no moment old paths find nothing but this one
    except OSError as e:
        link.unlink()
        raise RuntimeError(f"{old} came back as a folder while it moved ({e}); move what's in it to {new}.")


def run(root: Path, data: Path) -> dict:
    """Do it all, under a lock so two backends don't move the folder at once. Returns what changed."""
    root.mkdir(parents=True, exist_ok=True)
    with open(root / ".freya-migrate.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        moved = not data_moved(root)
        move_data(root)
        data = root / "freya"
        # The workspace's copy of the plugin's template learns 'freya' now, not at the next build: the skill teaches
        # `from 'freya'`, and the dev server serves apps live from that copy.
        if (data / "workspace").is_dir():
            from . import appserver
            appserver._build().seed(data / "workspace")
        changed = []
        for p in _stale(_sources(data)) + _stale(_memories(root)):
            text = p.read_text()
            tmp = p.with_name(p.name + ".freya-tmp")
            tmp.write_text(rewrite(text))
            os.chmod(tmp, p.stat().st_mode & 0o777)
            os.replace(tmp, p)
            changed.append(str(p.relative_to(root)))
        return {"ok": True, "moved": moved, "rewrote": changed, **check(root, data)}
