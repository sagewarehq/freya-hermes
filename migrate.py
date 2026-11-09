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

- **Routines** (Hermes's cron jobs, every profile's), through Hermes's own cron module, which takes its jobs lock:
  the same three names in their prompt, script and skills, and their working folder.
- **The apps server**, started again from Freya's plugin if Talaria's started the one running.

``/freya migrate --start`` runs all of that in the background, in Hermes's own process, and says so at once; ``/freya
migrate --status`` says how far it got. The phone only starts it and watches: its connection can drop, the app can
sleep, and the move still finishes (the phone's connection drops while Hermes reloads plugins, and on a phone away
from home it drops often). ``/freya migrate`` alone does the files and returns when they're done, as before.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import threading
import time
import uuid
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


# ---- Routines ----------------------------------------------------------------------------------------------------

def job_updates(job: dict) -> dict:
    """What changes in one cron job: only the fields that name Talaria."""
    updates: dict = {}
    for field in ("prompt", "script", "skill", "workdir"):
        text = job.get(field)
        if isinstance(text, str) and rewrite(text) != text:
            updates[field] = rewrite(text)
    skills = job.get("skills")
    if isinstance(skills, list) and any(isinstance(k, str) and rewrite(k) != k for k in skills):
        updates["skills"] = [rewrite(k) if isinstance(k, str) else k for k in skills]
        if isinstance(job.get("skill"), str):  # Hermes keeps the two in step; give it both
            updates["skill"] = rewrite(job["skill"])
    return updates


def _cron_homes(root: Path) -> list[Path]:
    profiles = sorted(p for p in (root / "profiles").glob("*") if p.is_dir()) if (root / "profiles").is_dir() else []
    return [h for h in [root, *profiles] if (h / "cron" / "jobs.json").is_file()]


def routines(root: Path, failed: list[str] | None = None) -> list[str] | None:
    """Rewrite every profile's routines that name Talaria; their names. None when this Hermes has no cron module to
    do it with (the phone then does it through Hermes's API). One Hermes won't take (a working folder that's gone,
    say) stays as it was, named in ``failed``, and the rest still go: it works on through the talaria link."""
    try:
        from cron import jobs as cron
        cron.use_cron_store, cron.list_jobs, cron.update_job  # noqa: B018 (older Hermes: the phone does it)
    except (ImportError, AttributeError):
        return None
    fixed: list[str] = []
    for home in _cron_homes(root):
        with cron.use_cron_store(home):
            for job in cron.list_jobs(include_disabled=True):
                updates = job_updates(job)
                if updates and job.get("id"):
                    try:
                        cron.update_job(job["id"], updates)
                    except (ValueError, OSError) as e:
                        if failed is not None:
                            failed.append(f"{job.get('name') or job['id']}: {e}"[:200])
                        continue
                    fixed.append(job.get("name") or job["id"])
    return fixed


# ---- The apps server ---------------------------------------------------------------------------------------------

def restart_apps() -> str:
    """Start the apps server again from Freya's plugin if an older one (Talaria's) is the one running. "done" or
    "skipped" (none running, or it's Freya's already); a start that fails is left for the next app opened."""
    from . import appserver
    state = appserver._state()
    port = state.get("port")
    if not port or appserver.ping(port)[:1] != ["talaria-apps"] or appserver._current(port):
        return "skipped"
    try:
        appserver.start()
        return "done"
    except Exception:
        return "skipped"


# ---- In the background -------------------------------------------------------------------------------------------

STATUS = ".freya-migrate.json"
STEPS = ("data", "routines", "apps")
# A run that hasn't written for this long died with the process that ran it (Hermes restarted): it can start again.
STALE = 120
_starting = threading.Lock()


def status(root: Path) -> dict:
    """The last run: ``{"id", "state": running|done|failed|stalled, "steps": {step: waiting|running|done|skipped|phone|
    failed}, "routines": [names], "error"}``, or ``{"state": "none"}``."""
    try:
        s = json.loads((root / STATUS).read_text())
    except (OSError, ValueError):
        return {"state": "none"}
    if s.get("state") == "running" and not _alive(s) and time.time() - float(s.get("beat", 0)) > STALE:
        s["state"] = "stalled"
    return s


def _alive(s: dict) -> bool:
    """The run is going in this process: a slow step (the apps server's npm install) writes nothing for a while, and
    that isn't a stall. A run in another process is judged by its beat."""
    return s.get("pid") == os.getpid() and any(t.name == "freya-migrate" and t.is_alive() for t in threading.enumerate())


def _write(root: Path, s: dict) -> None:
    s["beat"] = time.time()
    tmp = root / (STATUS + ".tmp")
    tmp.write_text(json.dumps(s) + "\n")
    os.replace(tmp, root / STATUS)


def start(root: Path, data: Path) -> dict:
    """Start the move in the background, or say how the one under way is going."""
    with _starting:
        s = status(root)
        if s.get("state") == "running":
            return s
        s = {"id": uuid.uuid4().hex[:12], "state": "running", "started": time.time(), "pid": os.getpid(),
             "steps": {k: "waiting" for k in STEPS}, "routines": []}
        root.mkdir(parents=True, exist_ok=True)
        _write(root, s)
        threading.Thread(target=_job, args=(root, data, s), name="freya-migrate", daemon=True).start()
        return dict(s)


def _job(root: Path, data: Path, s: dict) -> None:
    def step(name: str, state: str) -> None:
        s["steps"][name] = state
        _write(root, s)

    current = "data"
    try:
        step("data", "running")
        r = run(root, data)
        s["rewrote"] = len(r["rewrote"])
        step("data", "done")
        current = "routines"
        step("routines", "running")
        failed: list[str] = []
        fixed = routines(root, failed)
        s["routines"] = fixed or []
        if failed:
            s["routines_failed"] = failed
        step("routines", "phone" if fixed is None else "done" if fixed else "skipped")
        current = "apps"
        step("apps", "running")
        step("apps", restart_apps())
        s["state"] = "done"
    except Exception as e:  # noqa: BLE001 (whatever it was, the phone shows it and can try again)
        s["steps"][current] = "failed"
        s["state"] = "failed"
        s["error"] = f"{e}"[:500] or type(e).__name__
    _write(root, s)
