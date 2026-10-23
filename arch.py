#!/usr/bin/env python3
"""
Arch Migrate - back up a CachyOS / Arch install and restore it on a fresh Arch.

  python3 arch.py            # opens the GUI
  python3 arch.py --no-browser --port 8765

Pure Python standard library. The UI is a local web page (Material You styled)
served on 127.0.0.1 only and protected by a random per-run token.
"""
import argparse, atexit, base64, datetime, hashlib, io, json, os, re, secrets, shlex, shutil, socket, zipfile
import stat, subprocess, sys, tarfile, tempfile, threading, time, urllib.parse
import urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOME = Path.home()
USER = os.environ.get("USER") or HOME.name
TOKEN = secrets.token_urlsafe(24)
PASSWORD = None          # sudo password, memory only
AUTHED = False
PORT = 0
TMP = Path(tempfile.mkdtemp(prefix="archmig-"))
atexit.register(lambda: shutil.rmtree(TMP, ignore_errors=True))

# ------------------------------------------------------------------ helpers
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
NAME_OK = re.compile(r"^[A-Za-z0-9@._+\-]+$")


def lines(cmd, timeout=120):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           env={**os.environ, "LC_ALL": "C"})
        return [l.strip() for l in r.stdout.splitlines() if l.strip()]
    except Exception:
        return []


def downloads_dir():
    try:
        r = subprocess.run(["xdg-user-dir", "DOWNLOAD"], capture_output=True,
                           text=True, timeout=3).stdout.strip()
        if r and Path(r).is_dir() and Path(r) != HOME:
            return Path(r)
    except Exception:
        pass
    return HOME / "Downloads"


def pretty_os():
    try:
        d = dict(l.split("=", 1) for l in Path("/etc/os-release").read_text().splitlines() if "=" in l)
        return d.get("PRETTY_NAME", "Linux").strip('"')
    except Exception:
        return "Linux"


def setup_sudo_wrapper():
    """A fake `sudo` first on PATH that always uses our askpass, so yay/makepkg/flatpak work without a tty."""
    ask = TMP / "askpass"
    ask.write_text('#!/bin/sh\nprintf "%s\\n" "$ARCHMIG_PW"\n')
    wrap = TMP / "bin"
    wrap.mkdir()
    (wrap / "sudo").write_text('#!/bin/sh\nexec /usr/bin/sudo -A "$@"\n')
    for f in (ask, wrap / "sudo"):
        f.chmod(0o700)


def child_env():
    env = dict(os.environ)
    env["PATH"] = f"{TMP / 'bin'}:{env.get('PATH', '')}"
    env["SUDO_ASKPASS"] = str(TMP / "askpass")
    env["ARCHMIG_PW"] = PASSWORD or ""
    env["LC_ALL"] = "C"
    env["PACMAN_AUTH"] = "sudo"
    return env


# ------------------------------------------------------------------ jobs
class Job:
    def __init__(self, title):
        self.id = secrets.token_hex(4)
        self.title = title
        self.lines = []
        self.status = "running"
        self.progress = 0.0
        self.step = ""
        self.result = {}

    def log(self, text):
        for ln in str(text).splitlines() or [""]:
            self.lines.append(ln)


JOBS, CURRENT, JOB_LOCK = {}, None, threading.Lock()


class Busy(Exception):
    pass


def start_job(title, fn, *args):
    global CURRENT
    with JOB_LOCK:
        if CURRENT and CURRENT.status == "running":
            raise Busy("Another task is still running")
        j = Job(title)
        JOBS[j.id] = j
        CURRENT = j

    def runner():
        try:
            fn(j, *args)
            if j.status == "running":
                j.status = "done"
            j.progress = 1.0
        except Exception as e:  # noqa
            j.log(f"ERROR: {e}")
            j.status = "error"

    threading.Thread(target=runner, daemon=True).start()
    return j


def run(job, cmd, cwd=None, stdin_text=None):
    job.log("$ " + " ".join(shlex.quote(c) for c in cmd))
    p = subprocess.Popen(cmd, cwd=cwd, env=child_env(),
                         stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         errors="replace", bufsize=1)
    if stdin_text is not None:
        p.stdin.write(stdin_text)
        p.stdin.close()
    for raw in p.stdout:
        raw = ANSI.sub("", raw.rstrip("\n")).split("\r")[-1].rstrip()
        if raw:
            job.log(raw)
    return p.wait()


def install_batch(job, prefix, names, failed, chunk=60):
    """Install in chunks; if a chunk fails retry package by package so one bad name doesn't kill the rest."""
    for i in range(0, len(names), chunk):
        part = names[i:i + chunk]
        if run(job, prefix + part) != 0:
            job.log("Chunk failed, retrying one by one…")
            for n in part:
                if run(job, prefix + [n]) != 0:
                    failed.append(n)


def ensure_yay(job):
    if shutil.which("yay"):
        return True
    job.log("yay not found, bootstrapping yay-bin from the AUR…")
    if run(job, ["sudo", "pacman", "-S", "--needed", "--noconfirm", "base-devel", "git"]) != 0:
        raise RuntimeError("could not install base-devel/git")
    work = Path(tempfile.mkdtemp(prefix="yay-", dir=TMP))
    if run(job, ["git", "clone", "--depth", "1", "https://aur.archlinux.org/yay-bin.git", str(work / "yay-bin")]) != 0:
        raise RuntimeError("git clone of yay-bin failed")
    if run(job, ["makepkg", "--noconfirm"], cwd=work / "yay-bin") != 0:
        raise RuntimeError("makepkg yay-bin failed")
    pk = [str(p) for p in (work / "yay-bin").glob("*.pkg.tar.*") if not p.name.endswith(".sig")]
    if not pk or run(job, ["sudo", "pacman", "-U", "--noconfirm"] + pk) != 0:
        raise RuntimeError("installing yay-bin failed")
    job.log("yay installed.")
    return True


# ------------------------------------------------------------------ file selection
SKIP_DIRS = {"Cache", "cache", "Code Cache", "GPUCache", "CachedData", "Crash Reports", "ShaderCache",
             "DawnCache", "GrShaderCache", "GraphiteDawnCache", "Trash", "node_modules", "__pycache__", ".cache"}
STEAM_SKIP = {"common", "shadercache", "downloading", "temp"}

FOLDERS_ON = {"Documents", "Pictures", "Videos", "Music", "Desktop", "Projects", "projects", "dev", "Dev",
              "code", "Code", "src", "git", "repos", "workspace", "Workspace"}
DOT_ON = {".ssh", ".gnupg", ".bashrc", ".bash_profile", ".bash_aliases", ".profile", ".zshrc", ".zprofile",
          ".zshenv", ".gitconfig", ".git-credentials", ".mozilla", ".thunderbird", ".vscode", ".var",
          ".docker", ".npmrc", ".tmux.conf", ".vimrc", ".vim", ".oh-my-zsh"}
DOT_HIDE = {".cache", ".config", ".local", ".Trash", ".Xauthority", ".ICEauthority", ".xsession-errors",
            ".xsession-errors.old", ".dbus", ".sudo_as_admin_successful"}


def cfg_off(name):
    n = name.lower()
    return "cachy" in n or n in {"fish", "chwd", "trash"}


def skip_file(name):
    return name.startswith("arch-migrate-") and (".tar" in name)


def walk_item(item, steam_games=False):
    """Yield absolute paths (dirs + files) that belong to a selection item."""
    rel, kind = item["rel"], item.get("kind", "path")
    if kind == "loose":
        base = HOME if rel == "." else HOME / rel
        try:
            for e in os.scandir(base):
                if e.is_dir(follow_symlinks=False) or skip_file(e.name):
                    continue
                if rel == "." and e.name.startswith("."):
                    continue
                yield e.path
        except OSError:
            pass
        return
    root = HOME / rel
    if not os.path.lexists(root):
        return
    if os.path.islink(root) or not os.path.isdir(root):
        if not skip_file(root.name):
            yield str(root)
        return
    yield str(root)
    for dp, dns, fns in os.walk(root, topdown=True, followlinks=False):
        keep = []
        for d in dns:
            p = os.path.join(dp, d)
            if d in SKIP_DIRS:
                continue
            if (not steam_games) and d in STEAM_SKIP and os.path.basename(dp) == "steamapps":
                continue
            if os.path.islink(p):
                yield p
                continue
            keep.append(d)
            yield p
        dns[:] = keep
        for f in fns:
            if not skip_file(f):
                yield os.path.join(dp, f)


def build_items():
    items = []

    def add(group, rel, label, on, kind="path"):
        items.append({"id": rel if kind == "path" else rel + "::loose", "rel": rel, "kind": kind,
                      "group": group, "label": label, "on": on})

    try:
        top = sorted(HOME.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        top = []
    add("folders", ".", "Loose files in your home folder", True, "loose")
    for p in top:
        if p.name.startswith("."):
            continue
        if p.is_dir():
            add("folders", p.name, p.name, p.name in FOLDERS_ON)
    for p in top:
        n = p.name
        if not n.startswith(".") or n in DOT_HIDE or n.startswith(".zcompdump"):
            continue
        add("dotfiles", n, n, n in DOT_ON)
    if (HOME / ".local/bin").is_dir():
        add("dotfiles", ".local/bin", ".local/bin (your scripts)", True)
    for group, sub in (("config", ".config"), ("data", ".local/share")):
        d = HOME / sub
        if not d.is_dir():
            continue
        has_loose = False
        for p in sorted(d.iterdir(), key=lambda p: p.name.lower()):
            if p.is_dir() and not p.is_symlink():
                add(group, f"{sub}/{p.name}", p.name, not cfg_off(p.name))
            else:
                has_loose = True
        if has_loose:
            add(group, sub, f"{sub} loose files", True, "loose")
    return items


ITEMS, SIZES, SIZE_STATE = {}, {}, {"gen": 0, "done": True}


def size_worker(gen, items):
    for it in items:
        if SIZE_STATE["gen"] != gen:
            return
        total = 0
        for p in walk_item(it, False):
            try:
                st = os.lstat(p)
                if stat.S_ISREG(st.st_mode):
                    total += st.st_size
            except OSError:
                pass
        SIZES[it["id"]] = total
    if SIZE_STATE["gen"] == gen:
        SIZE_STATE["done"] = True


def do_scan():
    items = build_items()
    ITEMS.clear()
    ITEMS.update({i["id"]: i for i in items})
    SIZES.clear()
    SIZE_STATE["gen"] += 1
    SIZE_STATE["done"] = False
    threading.Thread(target=size_worker, args=(SIZE_STATE["gen"], items), daemon=True).start()
    native, aur = lines(["pacman", "-Qqen"]), lines(["pacman", "-Qqem"])
    flat = lines(["flatpak", "list", "--app", "--columns=application"]) if shutil.which("flatpak") else []
    off = [n for n in native + aur if "cachy" in n.lower() or n in {"fish", "chwd"}]
    return {"items": items, "packages": {"native": native, "aur": aur, "flatpak": flat}, "off": off}


# ------------------------------------------------------------------ backup
class Exact:
    """File wrapper that always yields exactly `size` bytes (live files may grow/shrink/err while we read)."""

    def __init__(self, f, size):
        self.f, self.left = f, size

    def read(self, n=-1):
        if self.left <= 0:
            return b""
        if n is None or n < 0 or n > self.left:
            n = self.left
        try:
            b = self.f.read(n)
        except OSError:
            b = b""
        if len(b) < n:
            b += b"\0" * (n - len(b))
        self.left -= n
        return b


def job_backup(job, req):
    steam = bool(req.get("steam"))
    pk = req.get("packages", {})
    dest = Path(os.path.expanduser(req.get("dest") or str(downloads_dir()))).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    work = []
    for it in req.get("items", []):
        rel, kind = str(it.get("rel", "")), it.get("kind", "path")
        if rel.startswith("/") or ".." in Path(rel).parts or (kind == "path" and rel in ("", ".")):
            continue
        work.append({"rel": rel, "kind": kind})
    for x in req.get("extras", []):
        try:
            r = Path(os.path.expanduser(x)).resolve().relative_to(HOME)
            work.append({"rel": str(r), "kind": "path"})
        except Exception:
            job.log(f"Skipping extra path outside your home: {x}")
    job.step = "Collecting files"
    job.log("Collecting files…")
    entries, seen, total = [], set(), 0
    for it in work:
        for p in walk_item(it, steam):
            if p in seen:
                continue
            seen.add(p)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            entries.append(p)
            if stat.S_ISREG(st.st_mode):
                total += st.st_size
    job.log(f"{len(entries)} entries, {total / 1048576:.0f} MB uncompressed.")
    manifest = {"app": "arch-migrate", "version": 1,
                "created": datetime.datetime.now().isoformat(timespec="seconds"),
                "host": socket.gethostname(), "user": USER, "source_os": pretty_os(),
                "native": pk.get("native", []), "aur": pk.get("aur", []), "flatpak": pk.get("flatpak", []),
                "file_count": len(entries), "bytes": total, "items": [w["rel"] for w in work],
                "github": [{k: e.get(k) for k in ("repo", "mode", "kind", "fp", "asset")} for e in reg_load()]}
    use_zstd = bool(shutil.which("zstd"))
    name = "arch-migrate-" + datetime.datetime.now().strftime("%Y%m%d-%H%M") + (".tar.zst" if use_zstd else ".tar.gz")
    final, part = dest / name, dest / (name + ".part")
    proc = None
    if use_zstd:
        proc = subprocess.Popen(["zstd", "-T0", "-3", "-q", "-f", "-o", str(part)], stdin=subprocess.PIPE)
        tar = tarfile.open(fileobj=proc.stdin, mode="w|")
    else:
        job.log("zstd not found, falling back to gzip (slower).")
        tar = tarfile.open(part, "w:gz")
    data = json.dumps(manifest, indent=1).encode()
    ti = tarfile.TarInfo("manifest.json")
    ti.size, ti.mtime = len(data), time.time()
    tar.addfile(ti, io.BytesIO(data))
    job.step = "Archiving"
    done, bad = 0, 0
    for i, p in enumerate(entries):
        arc = "home/" + os.path.relpath(p, HOME)
        try:
            ti = tar.gettarinfo(p, arc)
            if ti is None:
                continue
            if ti.isreg():
                with open(p, "rb") as f:
                    tar.addfile(ti, Exact(f, ti.size))
                done += ti.size
            else:
                tar.addfile(ti)
        except OSError as e:
            bad += 1
            if bad <= 8:
                job.log(f"skipped {p}: {e}")
        if i % 200 == 0:
            job.progress = min(0.98, done / max(total, 1))
            if i % 2000 == 0:
                job.log(f"… {i}/{len(entries)} entries")
    tar.close()
    if proc:
        proc.stdin.close()
        if proc.wait() != 0:
            raise RuntimeError("zstd failed")
    os.replace(part, final)
    (dest / (name + ".json")).write_text(json.dumps(manifest, indent=1))
    job.result = {"path": str(final)}
    job.log(f"\nBackup saved: {final} ({final.stat().st_size / 1048576:.0f} MB)")
    if bad:
        job.log(f"{bad} files could not be read and were skipped.")


# ------------------------------------------------------------------ restore
def read_manifest(f):
    side = f.with_name(f.name + ".json")
    try:
        if side.is_file():
            return json.loads(side.read_text())
        r = subprocess.run(["tar", "-xOf", str(f), "--occurrence=1", "manifest.json"],
                           capture_output=True, timeout=180)
        return json.loads(r.stdout.decode())
    except Exception:
        return None


def list_backups(folder):
    out = []
    files = [p for p in folder.glob("arch-migrate-*.tar*")
             if not p.name.endswith((".part", ".json"))]
    for f in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True):
        out.append({"path": str(f), "name": f.name, "size": f.stat().st_size,
                    "mtime": f.stat().st_mtime, "manifest": read_manifest(f)})
    return out


STEP_NAMES = {"multilib": "Enable multilib", "update": "System update", "yay": "Install yay",
              "native": "Repo packages", "aur": "AUR packages", "flatpak": "Flatpak apps",
              "files": "Restore files", "github": "GitHub apps"}


def job_restore(job, req):
    steps, pk = req.get("steps", {}), req.get("packages", {})
    archive = Path(req["archive"])
    keep = bool(req.get("keep"))
    if not archive.is_file():
        raise RuntimeError("Backup file not found")
    ctx, failures = {"missing": []}, []
    clean = lambda L: [n for n in L if NAME_OK.match(n)]

    def multilib():
        conf = Path("/etc/pacman.conf").read_text()
        if re.search(r"^\[multilib\]", conf, re.M):
            job.log("multilib already enabled.")
            return
        new, n = re.subn(r"^#\[multilib\]\n#Include", "[multilib]\nInclude", conf, flags=re.M)
        if not n:
            new = conf.rstrip("\n") + "\n\n[multilib]\nInclude = /etc/pacman.d/mirrorlist\n"
        run(job, ["sudo", "cp", "/etc/pacman.conf", "/etc/pacman.conf.bak-archmigrate"])
        if run(job, ["sudo", "tee", "/etc/pacman.conf"], stdin_text=new) != 0:
            raise RuntimeError("could not write pacman.conf")
        run(job, ["sudo", "pacman", "-Sy", "--noconfirm"])

    def update():
        if run(job, ["sudo", "pacman", "-Syu", "--noconfirm"]) != 0:
            raise RuntimeError("system update reported errors")

    def yay():
        ensure_yay(job)

    def native():
        names = clean(pk.get("native", []))
        sync = set(lines(["pacman", "-Slq"]))
        if not sync:
            run(job, ["sudo", "pacman", "-Sy", "--noconfirm"])
            sync = set(lines(["pacman", "-Slq"]))
        avail = [n for n in names if n in sync]
        ctx["missing"] = [n for n in names if n not in sync]
        if ctx["missing"]:
            job.log(f"{len(ctx['missing'])} packages are not in the Arch repos (CachyOS-only?), trying AUR: "
                    + ", ".join(ctx["missing"][:20]))
        bad = []
        install_batch(job, ["sudo", "pacman", "-S", "--needed", "--noconfirm"], avail, bad)
        if bad:
            raise RuntimeError("failed: " + ", ".join(bad))

    def aur():
        ensure_yay(job)
        names = clean(pk.get("aur", [])) + ctx["missing"]
        bad = []
        install_batch(job, ["yay", "-S", "--needed", "--noconfirm", "--removemake"], names, bad, chunk=25)
        if bad:
            raise RuntimeError("failed: " + ", ".join(bad))

    def flatpak():
        ids = clean(pk.get("flatpak", []))
        if not ids:
            job.log("No flatpaks in this backup.")
            return
        run(job, ["sudo", "pacman", "-S", "--needed", "--noconfirm", "flatpak"])
        run(job, ["sudo", "flatpak", "remote-add", "--if-not-exists", "flathub",
                  "https://dl.flathub.org/repo/flathub.flatpakrepo"])
        bad = []
        install_batch(job, ["sudo", "flatpak", "install", "-y", "--noninteractive", "flathub"], ids, bad, chunk=15)
        if bad:
            raise RuntimeError("failed: " + ", ".join(bad))

    def files():
        total = int((read_manifest(archive) or {}).get("file_count") or 0)
        cmd = ["tar", "-xvf", str(archive), "-C", str(HOME), "--strip-components=1",
               "--wildcards", "home/*", "--no-same-owner"]
        if keep:
            cmd.append("--skip-old-files")
        job.log("$ " + " ".join(shlex.quote(c) for c in cmd))
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
        n = 0
        for ln in p.stdout:
            if ln.startswith("home/"):
                n += 1
                if n % 500 == 0:
                    job.log(f"… {n} files restored")
            elif ln.strip():
                job.log(ln.strip())
        if p.wait() != 0:
            raise RuntimeError("tar reported errors")
        job.log(f"{n} files restored into {HOME}")

    def github():
        entries = req.get("github")
        if entries is None:
            entries = (read_manifest(archive) or {}).get("github", [])
        if not entries:
            job.log("No GitHub app records in this backup.")
            return
        for entry in entries:
            repo = str(entry.get("repo", ""))
            if not GH_RE.match(repo):
                msg = f"invalid GitHub repository record: {repo!r}"
                failures.append("GitHub: " + msg)
                job.log("! " + msg)
                continue
            mode = entry.get("mode", "asset")
            if mode == "pkgbuild":
                msg = f"{repo} uses a PKGBUILD and requires manual review before rebuilding"
                failures.append("GitHub: " + msg)
                job.log("! " + msg)
                continue
            try:
                if mode == "clone":
                    gh_req = {"repo": repo, "mode": "clone"}
                else:
                    gh_req = {"repo": repo, "mode": "asset",
                              "fp": entry.get("fp"), "kind": entry.get("kind")}
                job.log(f"Restoring GitHub app {repo}…")
                job_gh_install(job, gh_req)
            except Exception as e:  # noqa
                msg = f"{repo}: {e}"
                failures.append("GitHub: " + msg)
                job.log("! " + msg)

    fns = {"multilib": multilib, "update": update, "yay": yay, "native": native, "aur": aur,
           "flatpak": flatpak, "files": files, "github": github}
    plan = [k for k in STEP_NAMES if steps.get(k)]
    for i, k in enumerate(plan):
        job.progress = i / max(len(plan), 1)
        job.step = STEP_NAMES[k]
        job.log(f"\n=== {STEP_NAMES[k]} ===")
        try:
            fns[k]()
        except Exception as e:  # noqa
            job.log(f"! {e}")
            failures.append(f"{STEP_NAMES[k]}: {e}")
    job.result = {"failed": failures}
    job.log("\n" + ("Finished with issues:\n  " + "\n  ".join(failures) if failures else "All done!"))
    job.log("Log out and back in (or reboot) so restored settings take effect.")


def job_install(job, names):
    ensure_yay(job)
    job.step = "Installing"
    bad = []
    install_batch(job, ["yay", "-S", "--needed", "--noconfirm", "--removemake"], names, bad, chunk=10)
    if bad:
        raise RuntimeError("failed: " + ", ".join(bad))
    job.log("Done.")


# ------------------------------------------------------------------ store
# Entries are (package, title, description). "flatpak:<id>" installs from Flathub.
CATALOG = [
    ("Browsers", "language", [
        ("firefox", "Firefox", "Fast, private, open-source browser"),
        ("chromium", "Chromium", "Open-source base of Chrome"),
        ("brave-bin", "Brave", "Chromium browser with built-in ad blocking"),
        ("google-chrome", "Google Chrome", "Google's browser"),
        ("zen-browser-bin", "Zen Browser", "Calm, customizable Firefox-based browser"),
        ("librewolf-bin", "LibreWolf", "Privacy-hardened Firefox"),
        ("vivaldi", "Vivaldi", "Power-user Chromium browser"),
        ("floorp-bin", "Floorp", "Flexible Firefox-based browser"),
        ("tor-browser-launcher", "Tor Browser", "Anonymous browsing via Tor"),
    ]),
    ("Chat & mail", "forum", [
        ("discord", "Discord", "Voice, video and text chat"),
        ("vesktop", "Vesktop", "Discord client with Vencord built in"),
        ("telegram-desktop", "Telegram", "Official Telegram desktop app"),
        ("signal-desktop", "Signal", "Private messenger"),
        ("element-desktop", "Element", "Matrix chat client"),
        ("slack-desktop", "Slack", "Team chat"),
        ("zoom", "Zoom", "Video meetings"),
        ("thunderbird", "Thunderbird", "Email, calendar and contacts"),
        ("whatsapp-for-linux", "WhatsApp", "Unofficial WhatsApp desktop client"),
    ]),
    ("Gaming", "sports_esports", [
        ("steam", "Steam", "Game store and launcher (needs multilib)"),
        ("lutris", "Lutris", "Open gaming platform for Linux"),
        ("heroic-games-launcher-bin", "Heroic", "Epic, GOG and Amazon games"),
        ("prismlauncher", "Prism Launcher", "Minecraft launcher"),
        ("protonup-qt", "ProtonUp-Qt", "Manage Proton-GE and Wine builds"),
        ("bottles", "Bottles", "Run Windows apps with Wine"),
        ("wine", "Wine", "Run Windows programs"),
        ("wine-staging", "Wine Staging", "Wine with experimental patches"),
        ("winetricks", "Winetricks", "Wine helper scripts"),
        ("gamemode", "GameMode", "On-demand game performance tuning"),
        ("gamescope", "Gamescope", "Micro-compositor for games"),
        ("mangohud", "MangoHud", "In-game performance overlay"),
        ("goverlay", "GOverlay", "GUI for MangoHud and vkBasalt"),
        ("moonlight-qt", "Moonlight", "Stream games from your PC"),
        ("retroarch", "RetroArch", "All-in-one emulator frontend"),
        ("dolphin-emu", "Dolphin", "GameCube and Wii emulator"),
        ("pcsx2", "PCSX2", "PlayStation 2 emulator"),
        ("mgba-qt", "mGBA", "Game Boy Advance emulator"),
    ]),
    ("Video & audio", "movie", [
        ("vlc", "VLC", "Plays almost anything"),
        ("mpv", "mpv", "Minimal, powerful video player"),
        ("haruna", "Haruna", "Plasma-friendly video player"),
        ("obs-studio", "OBS Studio", "Recording and streaming"),
        ("kdenlive", "Kdenlive", "Video editor"),
        ("shotcut", "Shotcut", "Cross-platform video editor"),
        ("handbrake", "HandBrake", "Video transcoder"),
        ("ffmpeg", "FFmpeg", "Convert and process media"),
        ("yt-dlp", "yt-dlp", "Download videos from the web"),
        ("mkvtoolnix-gui", "MKVToolNix", "Edit Matroska files"),
        ("audacity", "Audacity", "Audio editor"),
        ("kodi", "Kodi", "Home theater app"),
    ]),
    ("Music", "music_note", [
        ("spotify", "Spotify", "Music streaming"),
        ("strawberry", "Strawberry", "Music collection player"),
        ("elisa", "Elisa", "Simple KDE music player"),
        ("cava", "Cava", "Terminal audio visualizer"),
        ("easyeffects", "EasyEffects", "Audio effects and EQ for PipeWire"),
        ("pavucontrol", "PulseAudio Volume Control", "Per-app volume and devices"),
        ("qpwgraph", "qpwgraph", "PipeWire patchbay"),
        ("ardour", "Ardour", "Digital audio workstation"),
        ("lmms", "LMMS", "Make music with samples and synths"),
        ("musescore", "MuseScore", "Music notation"),
    ]),
    ("Creative", "brush", [
        ("gimp", "GIMP", "Image editor"),
        ("krita", "Krita", "Digital painting"),
        ("inkscape", "Inkscape", "Vector graphics"),
        ("blender", "Blender", "3D creation suite"),
        ("godot", "Godot", "Game engine"),
        ("darktable", "darktable", "RAW photo workflow"),
        ("rawtherapee", "RawTherapee", "RAW photo processor"),
        ("digikam", "digiKam", "Photo manager"),
        ("freecad", "FreeCAD", "Parametric 3D CAD"),
        ("openscad", "OpenSCAD", "Programmer's 3D modeller"),
        ("scribus", "Scribus", "Desktop publishing"),
        ("kolourpaint", "KolourPaint", "Simple paint program"),
        ("aseprite", "Aseprite", "Pixel art and sprites"),
    ]),
    ("Development", "code", [
        ("visual-studio-code-bin", "VS Code", "Microsoft's code editor"),
        ("zed", "Zed", "Fast collaborative editor"),
        ("neovim", "Neovim", "Hyperextensible Vim"),
        ("helix", "Helix", "Modal editor in Rust"),
        ("git", "Git", "Version control"),
        ("github-cli", "GitHub CLI", "gh from the terminal"),
        ("lazygit", "lazygit", "Terminal UI for git"),
        ("docker", "Docker", "Containers"),
        ("docker-compose", "Docker Compose", "Multi-container apps"),
        ("podman", "Podman", "Daemonless containers"),
        ("nodejs", "Node.js", "JavaScript runtime"),
        ("npm", "npm", "Node package manager"),
        ("pnpm", "pnpm", "Fast Node package manager"),
        ("bun-bin", "Bun", "All-in-one JS runtime"),
        ("deno", "Deno", "Secure JS/TS runtime"),
        ("python-pipx", "pipx", "Install Python apps in isolation"),
        ("uv", "uv", "Very fast Python package manager"),
        ("rustup", "Rustup", "Rust toolchain installer"),
        ("go", "Go", "Go language toolchain"),
        ("jdk-openjdk", "OpenJDK", "Java development kit"),
        ("clang", "Clang", "C/C++ compiler"),
        ("cmake", "CMake", "Build system generator"),
        ("gdb", "GDB", "Debugger"),
        ("dbeaver", "DBeaver", "Universal database tool"),
        ("insomnia-bin", "Insomnia", "API client"),
        ("postman-bin", "Postman", "API platform"),
        ("jetbrains-toolbox", "JetBrains Toolbox", "Manage JetBrains IDEs"),
    ]),
    ("Terminal tools", "terminal", [
        ("kitty", "kitty", "GPU terminal emulator"),
        ("alacritty", "Alacritty", "Fast terminal emulator"),
        ("wezterm", "WezTerm", "GPU terminal with multiplexer"),
        ("tmux", "tmux", "Terminal multiplexer"),
        ("zsh", "Zsh", "Powerful shell"),
        ("starship", "Starship", "Fast, pretty shell prompt"),
        ("htop", "htop", "Interactive process viewer"),
        ("btop", "btop", "Resource monitor"),
        ("fastfetch", "fastfetch", "System info in the terminal"),
        ("ripgrep", "ripgrep", "Blazing fast grep"),
        ("fd", "fd", "Friendly find"),
        ("bat", "bat", "cat with syntax highlighting"),
        ("eza", "eza", "Modern ls"),
        ("fzf", "fzf", "Fuzzy finder"),
        ("zoxide", "zoxide", "Smarter cd"),
        ("jq", "jq", "JSON processor"),
        ("ncdu", "ncdu", "Disk usage in the terminal"),
        ("yazi", "Yazi", "Terminal file manager"),
        ("tldr", "tldr", "Simplified man pages"),
    ]),
    ("Privacy & security", "shield", [
        ("flatpak:io.ente.photos", "Ente Photos", "End-to-end encrypted photo storage and backup (desktop)"),
        ("flatpak:io.ente.auth", "Ente Auth", "Open-source 2FA authenticator with encrypted sync"),
        ("bitwarden", "Bitwarden", "Password manager"),
        ("keepassxc", "KeePassXC", "Offline password manager"),
        ("veracrypt", "VeraCrypt", "Disk encryption"),
        ("mullvad-vpn-bin", "Mullvad VPN", "Privacy-focused VPN"),
        ("proton-vpn-gtk-app", "Proton VPN", "Proton's VPN client"),
        ("protonmail-bridge", "Proton Mail Bridge", "Use Proton Mail with any mail client"),
        ("wireguard-tools", "WireGuard tools", "Fast modern VPN"),
        ("openvpn", "OpenVPN", "Classic VPN"),
        ("ufw", "UFW", "Simple firewall"),
        ("gnupg", "GnuPG", "Encryption and signing"),
    ]),
    ("Network", "lan", [
        ("qbittorrent", "qBittorrent", "Torrent client"),
        ("tailscale", "Tailscale", "Easy mesh VPN"),
        ("syncthing", "Syncthing", "Sync files between devices"),
        ("rclone", "rclone", "Cloud storage from the command line"),
        ("nmap", "Nmap", "Network scanner"),
        ("wireshark-qt", "Wireshark", "Packet analyzer"),
        ("openssh", "OpenSSH", "SSH client and server"),
        ("rustdesk-bin", "RustDesk", "Remote desktop"),
        ("filezilla", "FileZilla", "FTP/SFTP client"),
        ("ktorrent", "KTorrent", "KDE torrent client"),
    ]),
    ("Office & notes", "work", [
        ("libreoffice-fresh", "LibreOffice", "Office suite"),
        ("onlyoffice-bin", "ONLYOFFICE", "Office suite with MS format focus"),
        ("obsidian", "Obsidian", "Markdown notes"),
        ("logseq-desktop-bin", "Logseq", "Outliner and knowledge base"),
        ("joplin-desktop", "Joplin", "Notes with sync"),
        ("zotero", "Zotero", "Reference manager"),
        ("calibre", "Calibre", "E-book manager"),
        ("foliate", "Foliate", "E-book reader"),
        ("okular", "Okular", "PDF and document viewer"),
        ("xournalpp", "Xournal++", "Handwritten notes and PDF annotation"),
    ]),
    ("KDE apps", "widgets", [
        ("kate", "Kate", "Advanced text editor"),
        ("ark", "Ark", "Archive manager"),
        ("gwenview", "Gwenview", "Image viewer"),
        ("spectacle", "Spectacle", "Screenshots"),
        ("kcalc", "KCalc", "Calculator"),
        ("kdeconnect", "KDE Connect", "Link your phone and PC"),
        ("partitionmanager", "KDE Partition Manager", "Disk partitions"),
        ("filelight", "Filelight", "See what's eating disk space"),
        ("kcolorchooser", "KColorChooser", "Pick colors from the screen"),
        ("yakuake", "Yakuake", "Drop-down terminal"),
        ("krdc", "KRDC", "Remote desktop client"),
        ("ksystemlog", "KSystemLog", "System log viewer"),
        ("dolphin-plugins", "Dolphin plugins", "Git, Dropbox and more in Dolphin"),
        ("kdegraphics-thumbnailers", "Graphics thumbnailers", "Previews for RAW, PDF, etc."),
        ("ffmpegthumbs", "Video thumbnails", "Video previews in Dolphin"),
    ]),
    ("Utilities", "build", [
        ("flameshot", "Flameshot", "Screenshot and annotate"),
        ("copyq", "CopyQ", "Clipboard manager"),
        ("meld", "Meld", "Visual diff and merge"),
        ("baobab", "Disk Usage Analyzer", "Disk usage as a ring chart"),
        ("bleachbit", "BleachBit", "Clean junk files"),
        ("timeshift", "Timeshift", "System snapshots"),
        ("gparted", "GParted", "Partition editor"),
        ("ventoy-bin", "Ventoy", "Multiboot USB drives"),
        ("balena-etcher", "balenaEtcher", "Flash ISOs to USB"),
        ("rpi-imager", "Raspberry Pi Imager", "Flash SD cards for Pi"),
        ("p7zip", "7-Zip", "Archive tool"),
        ("unzip", "unzip", "Extract zip files"),
        ("rsync", "rsync", "Fast file sync"),
        ("borg", "BorgBackup", "Deduplicating backups"),
        ("restic", "restic", "Fast encrypted backups"),
        ("flatpak", "Flatpak", "Flathub app support"),
    ]),
    ("Android", "phone_android", [
        ("android-tools", "Android tools", "adb and fastboot"),
        ("scrcpy", "scrcpy", "Mirror and control your Android phone"),
        ("android-studio", "Android Studio", "Official Android IDE"),
        ("heimdall", "Heimdall", "Flash Samsung firmware"),
        ("payload-dumper-go-bin", "payload-dumper-go", "Extract Android OTA payloads"),
        ("apktool", "Apktool", "Reverse-engineer APKs"),
        ("jadx", "jadx", "Decompile Android apps"),
    ]),
    ("System", "memory", [
        ("networkmanager", "NetworkManager", "Network connection manager"),
        ("bluez", "BlueZ", "Bluetooth stack"),
        ("bluez-utils", "BlueZ utils", "bluetoothctl and friends"),
        ("pipewire-pulse", "PipeWire PulseAudio", "PulseAudio compatibility layer"),
        ("cups", "CUPS", "Printing system"),
        ("sof-firmware", "SOF firmware", "Audio firmware for newer Intel devices"),
        ("reflector", "Reflector", "Rank the fastest Arch mirrors"),
        ("pacman-contrib", "pacman-contrib", "paccache, checkupdates and more"),
        ("yay", "yay", "AUR helper"),
        ("paru", "paru", "Another AUR helper"),
        ("lsof", "lsof", "List open files"),
        ("man-db", "man pages", "Read documentation with man"),
    ]),
    ("Fonts & themes", "palette", [
        ("noto-fonts", "Noto Fonts", "Wide language coverage"),
        ("noto-fonts-emoji", "Noto Emoji", "Color emoji"),
        ("ttf-liberation", "Liberation Fonts", "Arial/Times-compatible fonts"),
        ("ttf-jetbrains-mono-nerd", "JetBrains Mono Nerd", "Coding font with icons"),
        ("ttf-fira-code", "Fira Code", "Coding font with ligatures"),
        ("ttf-roboto", "Roboto", "Google's Android font"),
        ("ttf-ms-win11-auto", "Windows fonts", "Microsoft fonts for documents"),
        ("papirus-icon-theme", "Papirus Icons", "Popular icon theme"),
        ("kvantum", "Kvantum", "SVG-based Qt theme engine"),
        ("materia-kde", "Materia KDE", "Material-style KDE theme"),
    ]),
]

FP_OK = re.compile(r"^[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)+$")
PROTECTED = {"base", "linux", "linux-lts", "linux-zen", "linux-hardened", "linux-firmware", "pacman",
             "systemd", "systemd-libs", "sudo", "bash", "glibc", "filesystem", "coreutils", "util-linux",
             "grub", "efibootmgr", "networkmanager", "sddm", "shadow", "gcc-libs", "archlinux-keyring",
             "mkinitcpio", "dracut", "iproute2", "pam", "openssl", "pacman-mirrorlist"}


def protected(name):
    return name in PROTECTED or bool(re.match(r"^linux-cachyos(-[a-z0-9]+)*$", name)) \
        or bool(re.match(r"^linux(-lts|-zen|-hardened)?-(firmware|nvidia.*)$", name))


def flatpak_ids():
    if not shutil.which("flatpak"):
        return set()
    return set(lines(["flatpak", "list", "--app", "--columns=application"]))


def installed_set():
    return set(lines(["pacman", "-Qq"])) | {"flatpak:" + i for i in flatpak_ids()}


def catalog():
    inst = installed_set()
    return [{"pkg": p, "title": t, "desc": d, "cat": cat, "icon": ic, "installed": p in inst}
            for cat, ic, apps in CATALOG for p, t, d in apps]


def ensure_flatpak(job):
    if not shutil.which("flatpak"):
        if run(job, ["sudo", "pacman", "-S", "--needed", "--noconfirm", "flatpak"]) != 0:
            raise RuntimeError("could not install flatpak")
    run(job, ["sudo", "flatpak", "remote-add", "--if-not-exists", "flathub",
              "https://dl.flathub.org/repo/flathub.flatpakrepo"])


def job_install(job, names):
    pac = [n for n in names if not n.startswith("flatpak:")]
    fps = [n[8:] for n in names if n.startswith("flatpak:")]
    bad = []
    if pac:
        ensure_yay(job)
        job.step = "Installing packages"
        install_batch(job, ["yay", "-S", "--needed", "--noconfirm", "--removemake"], pac, bad, chunk=10)
    if fps:
        ensure_flatpak(job)
        job.step = "Installing flatpaks"
        install_batch(job, ["sudo", "flatpak", "install", "-y", "--noninteractive", "flathub"], fps, bad, chunk=10)
    if bad:
        raise RuntimeError("failed: " + ", ".join(bad))
    job.log("Done.")


def search(q):
    q = q.strip()
    if not q:
        return []
    inst = installed_set()
    res, seen, cur = [], set(), None
    try:
        out = subprocess.run(["pacman", "-Ss", q], capture_output=True, text=True, timeout=30,
                             env={**os.environ, "LC_ALL": "C"}).stdout
    except Exception:
        out = ""
    for l in out.splitlines():
        if l.startswith(" "):
            if cur:
                cur["desc"] = l.strip()
        else:
            m = re.match(r"^(\S+)/(\S+) (\S+)", l)
            if m and len(res) < 40:
                cur = {"pkg": m.group(2), "ver": m.group(3), "src": m.group(1), "desc": "", "votes": 0,
                       "installed": m.group(2) in inst}
                res.append(cur)
                seen.add(cur["pkg"])
    try:
        url = "https://aur.archlinux.org/rpc/v5/search/" + urllib.parse.quote(q) + "?by=name-desc"
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.load(r).get("results", [])
        data.sort(key=lambda x: x.get("Popularity", 0), reverse=True)
        for x in data[:40]:
            if x["Name"] not in seen:
                res.append({"pkg": x["Name"], "ver": x.get("Version", ""), "src": "aur",
                            "desc": x.get("Description") or "", "votes": x.get("NumVotes", 0),
                            "installed": x["Name"] in inst})
    except Exception:
        pass
    if shutil.which("flatpak"):
        try:
            out = subprocess.run(["flatpak", "search", "--columns=application,name,description", q],
                                 capture_output=True, text=True, timeout=25).stdout
            n = 0
            for l in out.splitlines():
                p = l.split("\t")
                if len(p) >= 2 and FP_OK.match(p[0].strip()) and n < 25:
                    pkg = "flatpak:" + p[0].strip()
                    res.append({"pkg": pkg, "title": p[1].strip(), "ver": "", "src": "flatpak",
                                "desc": p[2].strip() if len(p) > 2 else "", "votes": 0,
                                "installed": pkg in inst})
                    n += 1
        except Exception:
            pass
    return res


# ------------------------------------------------------------------ manage (inventory / remove)
UNITS = {"B": 1, "KiB": 1024, "MiB": 1048576, "GiB": 1073741824, "TiB": 1099511627776}


def parse_size(s):
    try:
        n, u = s.split()
        return int(float(n) * UNITS.get(u, 1))
    except Exception:
        return 0


def parse_qi(text):
    out = []
    for block in text.split("\n\n"):
        f = {}
        for l in block.splitlines():
            if l and not l[0].isspace() and ":" in l:
                k, v = l.split(":", 1)
                f[k.strip()] = v.strip()
        if "Name" in f:
            out.append(f)
    return out


def inventory():
    env = {**os.environ, "LC_ALL": "C"}

    def sp(cmd):
        try:
            return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=180).stdout
        except Exception:
            return ""

    foreign, orph = set(lines(["pacman", "-Qqm"])), set(lines(["pacman", "-Qdtq"]))
    gui = set()
    for l in sp(["pacman", "-Ql"]).splitlines():
        if "/usr/share/applications/" in l and l.endswith(".desktop"):
            gui.add(l.split(" ", 1)[0])
    pk = []
    for f in parse_qi(sp(["pacman", "-Qi"])):
        n, by = f["Name"], f.get("Required By", "None")
        pk.append({"n": n, "v": f.get("Version", ""), "d": f.get("Description", ""),
                   "sz": parse_size(f.get("Installed Size", "")),
                   "exp": f.get("Install Reason", "").startswith("Explicit"),
                   "aur": n in foreign, "orph": n in orph, "gui": n in gui,
                   "by": 0 if by in ("None", "") else len(by.split()), "prot": protected(n)})
    fp = []
    if shutil.which("flatpak"):
        for l in sp(["flatpak", "list", "--app", "--columns=application,name,version,size"]).splitlines():
            p = l.split("\t")
            if len(p) >= 2 and FP_OK.match(p[0].strip()):
                fp.append({"id": p[0].strip(), "name": p[1].strip(),
                           "v": p[2].strip() if len(p) > 2 else "", "size": p[3].strip() if len(p) > 3 else ""})
    return {"pacman": pk, "flatpak": fp}


def remove_plan(names):
    names = [n for n in names if NAME_OK.match(n)]
    bad = [n for n in names if protected(n)]
    if bad:
        raise RuntimeError("Protected system packages can't be removed here: " + ", ".join(bad))
    if not names:
        return []
    r = subprocess.run(["sudo", "pacman", "-Rns", "--print", "--print-format", "%n"] + names,
                       capture_output=True, text=True, env=child_env(), timeout=120)
    if r.returncode != 0:
        raise RuntimeError(ANSI.sub("", (r.stderr or r.stdout).strip())[-400:] or "pacman refused")
    return [l.strip() for l in r.stdout.splitlines() if NAME_OK.match(l.strip())]


def job_manage(job, req):
    kind = req.get("kind")
    if kind == "remove":
        names = [n for n in req.get("names", []) if NAME_OK.match(n)]
        bad = [n for n in names if protected(n)]
        if bad:
            raise RuntimeError("Protected: " + ", ".join(bad))
        fps = [i for i in req.get("flatpaks", []) if FP_OK.match(i)]
        if names:
            job.step = "Removing packages"
            if run(job, ["sudo", "pacman", "-Rns", "--noconfirm"] + names) != 0:
                raise RuntimeError("pacman could not remove everything")
        if fps:
            job.step = "Removing flatpaks"
            if run(job, ["sudo", "flatpak", "uninstall", "-y", "--noninteractive"] + fps) != 0:
                raise RuntimeError("flatpak could not remove everything")
            run(job, ["sudo", "flatpak", "uninstall", "--unused", "-y", "--noninteractive"])
        job.log("Removed.")
    elif kind == "update":
        ensure_yay(job)
        job.step = "Updating packages"
        if run(job, ["yay", "-Syu", "--noconfirm", "--removemake"]) != 0:
            raise RuntimeError("update reported errors")
        if shutil.which("flatpak"):
            job.step = "Updating flatpaks"
            run(job, ["sudo", "flatpak", "update", "-y", "--noninteractive"])
        job.log("Everything is up to date.")
    elif kind == "cache":
        job.step = "Cleaning package cache"
        if run(job, ["sudo", "pacman", "-Sc", "--noconfirm"]) != 0:
            raise RuntimeError("cache clean failed")
        job.log("Package cache cleaned.")
    elif kind == "orphans":
        job.step = "Removing orphan packages"
        names = [n for n in lines(["pacman", "-Qdtq"]) if NAME_OK.match(n) and not protected(n)]
        if names:
            if run(job, ["sudo", "pacman", "-Rns", "--noconfirm"] + names) != 0:
                raise RuntimeError("could not remove all orphan packages")
            job.log("Removed: " + ", ".join(names))
        else:
            job.log("No orphan packages found.")
    elif kind == "service":
        unit = str(req.get("unit", ""))
        if unit not in SERVICE_NAMES:
            raise RuntimeError("unknown or unsupported service")
        action = "enable" if req.get("on") else "disable"
        job.step = ("Enabling " if action == "enable" else "Disabling ") + unit
        if run(job, ["sudo", "systemctl", action, "--now", unit]) != 0:
            raise RuntimeError("systemctl failed for " + unit)
        job.log("Service updated: " + unit)
    elif kind == "mirrors":
        job.step = "Refreshing package mirrors"
        if not shutil.which("reflector"):
            if run(job, ["sudo", "pacman", "-S", "--needed", "--noconfirm", "reflector"]) != 0:
                raise RuntimeError("could not install reflector")
        if run(job, ["sudo", "reflector", "--latest", "20", "--protocol", "https", "--sort", "rate",
                     "--save", "/etc/pacman.d/mirrorlist"]) != 0:
            raise RuntimeError("reflector failed to refresh mirrors")
        job.log("Mirror list refreshed.")
    elif kind == "ghinstall":
        job_gh_install(job, req)
    elif kind == "ghupdate":
        gh_update(job, str(req.get("repo", "")))
    elif kind == "ghremove":
        gh_remove(job, str(req.get("repo", "")))
    else:
        raise RuntimeError("unknown task")

# ------------------------------------------------------------------ overview / services / bundles
SERVICES = [
    ("NetworkManager.service", "Network", "Ethernet and Wi-Fi"),
    ("bluetooth.service", "Bluetooth", "Needs bluez + bluez-utils"),
    ("sddm.service", "Login screen", "SDDM, the Plasma login manager"),
    ("cups.service", "Printing", "Needs cups"),
    ("fstrim.timer", "SSD trim", "Weekly TRIM, keeps SSDs fast"),
    ("paccache.timer", "Package cache cleaner", "Needs pacman-contrib"),
    ("reflector.timer", "Mirror refresh", "Needs reflector"),
    ("ufw.service", "Firewall", "Needs ufw"),
    ("docker.service", "Docker", "Needs docker"),
    ("sshd.service", "SSH server", "Needs openssh"),
    ("tailscaled.service", "Tailscale", "Needs tailscale"),
    ("systemd-timesyncd.service", "Time sync", "Keeps the clock right"),
]
SERVICE_NAMES = {s[0] for s in SERVICES}

BUNDLES = [
    ("plasma", "Plasma essentials", "desktop_windows",
     "Everything a full KDE desktop usually wants: network, sound, Bluetooth and power widgets, portals, thumbnails.",
     ["plasma-desktop", "sddm", "kscreen", "plasma-nm", "plasma-pa", "bluedevil", "powerdevil", "kde-gtk-config",
      "breeze-gtk", "xdg-desktop-portal-kde", "plasma-systemmonitor", "plasma-browser-integration",
      "print-manager", "kdeplasma-addons", "dolphin", "konsole", "kate", "ark", "gwenview", "spectacle",
      "kcalc", "okular", "kdeconnect", "partitionmanager", "filelight", "dolphin-plugins", "ffmpegthumbs",
      "kdegraphics-thumbnailers", "kio-extras", "kio-admin"]),
    ("audio", "Sound that just works", "volume_up",
     "PipeWire with every compatibility layer, plus firmware for newer laptops.",
     ["pipewire", "pipewire-pulse", "pipewire-alsa", "pipewire-jack", "wireplumber", "alsa-utils",
      "sof-firmware", "alsa-firmware", "pavucontrol"]),
    ("network", "Network & Bluetooth", "wifi",
     "NetworkManager, Bluetooth stack and VPN plugins.",
     ["networkmanager", "network-manager-applet", "networkmanager-openvpn", "wireguard-tools", "bluez",
      "bluez-utils", "openssh", "wget", "curl", "avahi", "nss-mdns"]),
    ("fonts", "Fonts", "text_fields",
     "Wide language coverage, emoji and coding fonts so nothing renders as boxes.",
     ["noto-fonts", "noto-fonts-cjk", "noto-fonts-emoji", "noto-fonts-extra", "ttf-liberation", "ttf-dejavu",
      "ttf-roboto", "ttf-jetbrains-mono-nerd", "ttf-fira-code"]),
    ("gaming", "Gaming", "sports_esports",
     "Steam, Proton helpers, Wine, Vulkan, overlays. Needs multilib enabled.",
     ["steam", "gamemode", "lib32-gamemode", "mangohud", "lib32-mangohud", "gamescope", "lutris", "wine",
      "wine-mono", "wine-gecko", "winetricks", "vulkan-icd-loader", "lib32-vulkan-icd-loader", "protonup-qt"]),
    ("dev", "Dev basics", "code",
     "Compilers, git, runtimes and containers.",
     ["base-devel", "git", "github-cli", "nodejs", "npm", "python", "python-pip", "python-pipx", "rustup", "go",
      "jdk-openjdk", "cmake", "clang", "gdb", "docker", "docker-compose", "neovim", "ripgrep", "fd", "jq"]),
    ("tools", "Handy CLI tools", "terminal",
     "The small tools you end up wanting on every machine.",
     ["htop", "btop", "fastfetch", "bat", "eza", "fzf", "zoxide", "tmux", "ncdu", "tldr", "man-db", "man-pages",
      "unzip", "p7zip", "unrar", "rsync", "pacman-contrib", "reflector", "lsof", "bind"]),
    ("android", "Android tools", "phone_android",
     "adb, fastboot and screen mirroring.",
     ["android-tools", "scrcpy", "android-udev"]),
    ("hardware", "Hardware & firmware", "developer_board",
     "CPU microcode, firmware, drivers for printers and USB drives.",
     ["linux-firmware", "intel-ucode", "amd-ucode", "fwupd", "cups", "cups-pdf", "ntfs-3g", "exfatprogs",
      "dosfstools", "udisks2", "gvfs", "mtpfs"]),
]
BUNDLE_MAP = {b[0]: b for b in BUNDLES}


def sysctl(args):
    try:
        r = subprocess.run(["systemctl"] + args, capture_output=True, text=True, timeout=10)
        return r.stdout.strip()
    except Exception:
        return ""


def service_state():
    out = []
    for unit, title, note in SERVICES:
        en = sysctl(["is-enabled", unit])
        exists = en not in ("", "not-found") or sysctl(["is-active", unit]) == "active"
        out.append({"unit": unit, "title": title, "note": note, "exists": exists,
                    "enabled": en in ("enabled", "static", "alias"), "active": sysctl(["is-active", unit]) == "active"})
    return out


def read_first(path, default=""):
    try:
        return Path(path).read_text().strip()
    except Exception:
        return default


def overview():
    mem = {}
    for l in read_first("/proc/meminfo").splitlines():
        k, _, v = l.partition(":")
        try:
            mem[k] = int(v.split()[0]) * 1024
        except Exception:
            pass
    cpu = ""
    for l in read_first("/proc/cpuinfo").splitlines():
        if l.startswith("model name"):
            cpu = l.split(":", 1)[1].strip()
            break
    try:
        up = float(read_first("/proc/uptime", "0").split()[0])
    except Exception:
        up = 0
    du = shutil.disk_usage("/")
    pk = lines(["pacman", "-Qq"])
    upd = lines(["checkupdates"], 40) if shutil.which("checkupdates") else lines(["pacman", "-Qu"])
    gpu = [l.split(": ", 1)[-1] for l in lines(["lspci"]) if "VGA" in l or "3D controller" in l]
    return {"os": pretty_os(), "kernel": read_first("/proc/sys/kernel/osrelease"), "uptime": up, "cpu": cpu,
            "gpu": gpu[:2], "mem_total": mem.get("MemTotal", 0), "mem_avail": mem.get("MemAvailable", 0),
            "disk_total": du.total, "disk_used": du.used, "packages": len(pk),
            "explicit": len(lines(["pacman", "-Qqe"])), "aur": len(lines(["pacman", "-Qqm"])),
            "orphans": len(lines(["pacman", "-Qdtq"])), "updates": len(upd), "update_list": upd[:80],
            "flatpaks": len(flatpak_ids()), "yay": bool(shutil.which("yay")),
            "efi": os.path.isdir("/sys/firmware/efi"), "desktop": os.environ.get("XDG_CURRENT_DESKTOP", ""),
            "shell": os.path.basename(os.environ.get("SHELL", "")),
            "cache": sum(f.stat().st_size for f in Path("/var/cache/pacman/pkg").glob("*") if f.is_file())
            if Path("/var/cache/pacman/pkg").is_dir() else 0}


# ------------------------------------------------------------------ themes (KDE Material You)
THEME_DIR = HOME / ".config" / "arch-migrate"
GTK_BEGIN, GTK_END = "/* arch-migrate material-you begin */", "/* arch-migrate material-you end */"


def hsl(h, s, l):
    import colorsys
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, max(0, min(1, l / 100.0)), max(0, min(1, s / 100.0)))
    return int(round(r * 255)), int(round(g * 255)), int(round(b * 255))


def hexc(c):
    return "#%02x%02x%02x" % c


def rgbs(c):
    return "%d,%d,%d" % c


def material_palette(h, dark, vivid=1.0):
    """Same recipe the app UI uses, so the desktop matches the window."""
    t = (h + 55) % 360
    v = lambda s: min(100, s * vivid)
    if dark:
        return {"bg": hsl(h, 14, 8), "sc": hsl(h, 13, 13), "sch": hsl(h, 13, 18), "on": hsl(h, 20, 90),
                "onv": hsl(h, 12, 76), "pr": hsl(h, v(80), 80), "onpr": hsl(h, 60, 20), "prc": hsl(h, 40, 30),
                "onprc": hsl(h, 90, 90), "sec": hsl(h, 25, 28), "onsec": hsl(h, 30, 90), "tc": hsl(t, 35, 28),
                "ontc": hsl(t, 70, 90), "outv": hsl(h, 12, 28), "ol": hsl(h, 8, 56),
                "err": (242, 184, 181), "pos": (166, 227, 161), "neu": (249, 226, 175)}
    return {"bg": hsl(h, 40, 98), "sc": hsl(h, 30, 94), "sch": hsl(h, 28, 91), "on": hsl(h, 15, 11),
            "onv": hsl(h, 10, 30), "pr": hsl(h, v(48), 42), "onpr": (255, 255, 255), "prc": hsl(h, 90, 90),
            "onprc": hsl(h, 70, 15), "sec": hsl(h, 40, 89), "onsec": hsl(h, 40, 15), "tc": hsl(t, 60, 88),
            "ontc": hsl(t, 60, 16), "outv": hsl(h, 18, 80), "ol": hsl(h, 8, 50),
            "err": (179, 38, 30), "pos": (32, 120, 50), "neu": (160, 100, 0)}


def kde_colors(name, h, dark, vivid=1.0):
    p = material_palette(h, dark, vivid)

    def group(title, bg, alt, fg, sel_fg=None):
        return (f"[Colors:{title}]\nBackgroundAlternate={rgbs(alt)}\nBackgroundNormal={rgbs(bg)}\n"
                f"DecorationFocus={rgbs(p['pr'])}\nDecorationHover={rgbs(p['pr'])}\n"
                f"ForegroundActive={rgbs(p['pr'])}\nForegroundInactive={rgbs(p['onv'])}\n"
                f"ForegroundLink={rgbs(p['pr'])}\nForegroundNegative={rgbs(p['err'])}\n"
                f"ForegroundNeutral={rgbs(p['neu'])}\nForegroundNormal={rgbs(fg)}\n"
                f"ForegroundPositive={rgbs(p['pos'])}\nForegroundVisited={rgbs(p['tc'] if dark else p['ontc'])}\n")

    sel = (f"[Colors:Selection]\nBackgroundAlternate={rgbs(p['pr'])}\nBackgroundNormal={rgbs(p['pr'])}\n"
           f"DecorationFocus={rgbs(p['pr'])}\nDecorationHover={rgbs(p['pr'])}\n"
           f"ForegroundActive={rgbs(p['onpr'])}\nForegroundInactive={rgbs(p['onpr'])}\n"
           f"ForegroundLink={rgbs(p['onpr'])}\nForegroundNegative={rgbs(p['err'])}\n"
           f"ForegroundNeutral={rgbs(p['neu'])}\nForegroundNormal={rgbs(p['onpr'])}\n"
           f"ForegroundPositive={rgbs(p['pos'])}\nForegroundVisited={rgbs(p['onpr'])}\n")
    eff = ("[ColorEffects:Disabled]\nColor={d}\nColorAmount=0\nColorEffect=0\nContrastAmount=0.65\nContrastEffect=1\n"
           "IntensityAmount=0.1\nIntensityEffect=2\n\n[ColorEffects:Inactive]\nChangeSelectedColor=true\nColor={d}\n"
           "ColorAmount=0.025\nColorEffect=2\nContrastAmount=0.1\nContrastEffect=2\nEnable=false\nIntensityAmount=0\n"
           "IntensityEffect=0\n").format(d=rgbs(p["ol"]))
    parts = [eff,
             group("Button", p["sch"], p["sec"], p["on"]),
             group("Complementary", p["sc"], p["sch"], p["on"]),
             group("Header", p["sc"], p["sch"], p["on"]),
             sel,
             group("Tooltip", p["sch"], p["sec"], p["on"]),
             group("View", p["bg"], p["sc"], p["on"]),
             group("Window", p["sc"], p["sch"], p["on"])]
    wm = (f"[General]\nColorScheme={name}\nName={name}\nshadeSortColumn=true\n\n[KDE]\ncontrast=4\n\n"
          f"[WM]\nactiveBackground={rgbs(p['sc'])}\nactiveBlend={rgbs(p['on'])}\nactiveForeground={rgbs(p['on'])}\n"
          f"inactiveBackground={rgbs(p['bg'])}\ninactiveBlend={rgbs(p['onv'])}\ninactiveForeground={rgbs(p['onv'])}\n")
    return "\n".join(parts) + "\n" + wm


def gtk_css(h, dark, vivid=1.0):
    p = material_palette(h, dark, vivid)
    d = {"accent_bg_color": p["pr"], "accent_fg_color": p["onpr"], "accent_color": p["pr"],
         "window_bg_color": p["sc"], "window_fg_color": p["on"], "view_bg_color": p["bg"],
         "view_fg_color": p["on"], "headerbar_bg_color": p["sc"], "headerbar_fg_color": p["on"],
         "card_bg_color": p["sch"], "card_fg_color": p["on"], "sidebar_bg_color": p["sc"],
         "sidebar_fg_color": p["on"], "popover_bg_color": p["sch"], "popover_fg_color": p["on"],
         "dialog_bg_color": p["sch"], "dialog_fg_color": p["on"], "destructive_bg_color": p["err"]}
    return "\n".join(f"@define-color {k} {hexc(v)};" for k, v in d.items())


def write_marked(path, block):
    path.parent.mkdir(parents=True, exist_ok=True)
    old = path.read_text() if path.exists() else ""
    if GTK_BEGIN in old and GTK_END in old:
        a, b = old.index(GTK_BEGIN), old.index(GTK_END) + len(GTK_END)
        old = (old[:a] + old[b:]).strip("\n")
    new = (old + "\n\n" if old.strip() else "") + GTK_BEGIN + "\n" + block + "\n" + GTK_END + "\n"
    path.write_text(new)


def strip_marked(path):
    if not path.exists():
        return
    old = path.read_text()
    if GTK_BEGIN in old and GTK_END in old:
        a, b = old.index(GTK_BEGIN), old.index(GTK_END) + len(GTK_END)
        path.write_text((old[:a] + old[b:]).strip("\n") + "\n")


def png_gradient(path, h, dark, w=960, ht=540):
    """Soft Material-style wallpaper (blurry colour blobs), pure python."""
    import zlib, struct, math
    p = material_palette(h, dark)
    base = p["bg"]
    blobs = [(0.15, 0.2, 0.55, hsl(h, 55 if dark else 70, 30 if dark else 82)),
             (0.85, 0.75, 0.6, hsl((h + 55) % 360, 45 if dark else 65, 26 if dark else 84)),
             (0.7, 0.1, 0.35, hsl((h - 40) % 360, 45 if dark else 60, 24 if dark else 86))]
    rows = []
    for y in range(ht):
        row = bytearray([0])
        fy = y / ht
        for x in range(w):
            fx = x / w
            r, g, b = base
            for cx, cy, rad, col in blobs:
                dx, dy = (fx - cx) * (w / ht), fy - cy
                a = max(0.0, 1 - math.sqrt(dx * dx + dy * dy) / rad)
                a = a * a * (3 - 2 * a) * 0.9
                r += (col[0] - r) * a
                g += (col[1] - g) * a
                b += (col[2] - b) * a
            row += bytes((int(r), int(g), int(b)))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, ht, 8, 2, 0, 0, 0)) +
                     chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def kread(group, key, file="kdeglobals"):
    for tool in ("kreadconfig6", "kreadconfig5"):
        if shutil.which(tool):
            try:
                return subprocess.run([tool, "--file", file, "--group", group, "--key", key],
                                      capture_output=True, text=True, timeout=5).stdout.strip()
            except Exception:
                return ""
    return ""


def theme_dirs(sub):
    out = set()
    for base in (HOME / ".local/share", Path("/usr/share")):
        d = base / sub
        if d.is_dir():
            out.update(p.name for p in d.iterdir() if p.is_dir())
    return sorted(out, key=str.lower)


def theme_info():
    kde = bool(shutil.which("plasma-apply-colorscheme"))
    schemes = set()
    for base in (HOME / ".local/share/color-schemes", Path("/usr/share/color-schemes")):
        if base.is_dir():
            schemes.update(p.stem for p in base.glob("*.colors"))
    return {"kde": kde, "desktop": os.environ.get("XDG_CURRENT_DESKTOP", ""),
            "current": {"scheme": kread("General", "ColorScheme"), "icons": kread("Icons", "Theme"),
                        "cursor": kread("Mouse", "cursorTheme", "kcminputrc"),
                        "plasma": kread("Theme", "name", "plasmarc")},
            "schemes": sorted(schemes, key=str.lower), "icons": theme_dirs("icons"),
            "cursors": theme_dirs("icons"),
            "plasma_themes": theme_dirs("plasma/desktoptheme"),
            "packages": [{"cat": cat, "items": [{"pkg": pkg, "title": title, "desc": desc}
                                                  for pkg, title, desc in entries]}
                         for cat, entries in THEME_PKGS],
            "tools": {t: bool(shutil.which(t)) for t in ("plasma-apply-colorscheme", "plasma-apply-wallpaperimage",
                                                         "plasma-apply-desktoptheme", "plasma-apply-cursortheme",
                                                         "plasma-changeicons")},
            "has_prev": (THEME_DIR / "theme-prev.json").exists()}


THEME_PKGS = [
    ("Icons", [("papirus-icon-theme", "Papirus", "Rounded, colourful, huge coverage"),
               ("tela-icon-theme", "Tela", "Flat circle-style icons"),
               ("breeze-icons", "Breeze", "KDE's default icons"),
               ("adwaita-icon-theme", "Adwaita", "GNOME icon theme"),
               ("papirus-folders", "Papirus Folders", "Recolour Papirus folders to match your accent")]),
    ("Cursors", [("bibata-cursor-theme", "Bibata", "Material-style cursors"),
                 ("breeze", "Breeze cursors", "KDE's default cursor"),
                 ("capitaine-cursors", "Capitaine", "macOS-like cursors")]),
    ("Plasma & widgets style", [("kvantum", "Kvantum", "SVG theme engine for Qt apps"),
                                ("materia-kde", "Materia", "Material-style Plasma and Kvantum themes"),
                                ("kde-material-you-colors", "KDE Material You Colors",
                                 "Live colours generated from your wallpaper (AUR)"),
                                ("plasma6-themes-ant-dark-git", "Ant Dark", "Dark Plasma theme with blur"),
                                ("breeze-gtk", "Breeze GTK", "Make GTK apps match Plasma"),
                                ("kde-gtk-config", "GTK settings in Plasma", "Settings page for GTK themes")]),
    ("Fonts", [("ttf-roboto", "Roboto", "Android's system font"),
               ("ttf-roboto-flex", "Roboto Flex", "The font this app uses"),
               ("inter-font", "Inter", "Clean UI font"),
               ("ttf-material-symbols-variable", "Material Symbols", "Google's icon font"),
               ("ttf-jetbrains-mono-nerd", "JetBrains Mono Nerd", "Coding font with icons")]),
]


def job_theme(job, req):
    h = int(req.get("hue", 265)) % 360
    dark = bool(req.get("dark", True))
    vivid = max(0.5, min(1.3, float(req.get("vivid", 1.0))))
    name = "MaterialYou" + re.sub(r"[^A-Za-z0-9]", "", str(req.get("label") or "Custom")) + ("Dark" if dark else "Light")
    THEME_DIR.mkdir(parents=True, exist_ok=True)
    prev = THEME_DIR / "theme-prev.json"
    if not prev.exists():
        prev.write_text(json.dumps({"scheme": kread("General", "ColorScheme"), "icons": kread("Icons", "Theme"),
                                    "cursor": kread("Mouse", "cursorTheme", "kcminputrc"),
                                    "plasma": kread("Theme", "name", "plasmarc")}))
        job.log("Saved your current look so you can revert.")
    job.step = "Colour scheme"
    cdir = HOME / ".local/share/color-schemes"
    cdir.mkdir(parents=True, exist_ok=True)
    (cdir / f"{name}.colors").write_text(kde_colors(name, h, dark, vivid))
    job.log(f"Wrote {cdir / (name + '.colors')}")
    job.progress = 0.2
    if shutil.which("plasma-apply-colorscheme"):
        run(job, ["plasma-apply-colorscheme", name])
    else:
        job.log("plasma-apply-colorscheme not found (not on Plasma?). Scheme saved, select it in System Settings.")
    if req.get("gtk"):
        job.step = "GTK apps"
        css = gtk_css(h, dark, vivid)
        for v in ("gtk-3.0", "gtk-4.0"):
            write_marked(HOME / ".config" / v / "gtk.css", css)
        job.log("GTK 3/4 colours written (only inside a marked block, the rest of your gtk.css is untouched).")
        if shutil.which("gsettings"):
            run(job, ["gsettings", "set", "org.gnome.desktop.interface", "color-scheme",
                      "prefer-dark" if dark else "prefer-light"])
    job.progress = 0.4
    for key, tool, label in (("icons", "plasma-changeicons", "Icon theme"),
                             ("cursor", "plasma-apply-cursortheme", "Cursor"),
                             ("plasma", "plasma-apply-desktoptheme", "Plasma style")):
        v = str(req.get(key) or "")
        if v and NAME_OK.match(v):
            job.step = label
            if shutil.which(tool):
                run(job, [tool, v])
            else:
                job.log(f"{tool} not found, skipping {label.lower()}.")
    job.progress = 0.6
    if req.get("wallpaper"):
        job.step = "Wallpaper"
        wp = HOME / ".local/share/wallpapers" / f"{name}.png"
        png_gradient(wp, h, dark)
        job.log(f"Generated {wp}")
        if shutil.which("plasma-apply-wallpaperimage"):
            run(job, ["plasma-apply-wallpaperimage", str(wp)])
        else:
            job.log("plasma-apply-wallpaperimage not found, set it manually.")
    job.log("\nDone. Some apps need a restart to pick up the colours.")


def job_theme_revert(job, req):
    prev = THEME_DIR / "theme-prev.json"
    if not prev.exists():
        raise RuntimeError("Nothing to revert to")
    d = json.loads(prev.read_text())
    for key, tool in (("scheme", "plasma-apply-colorscheme"), ("icons", "plasma-changeicons"),
                      ("cursor", "plasma-apply-cursortheme"), ("plasma", "plasma-apply-desktoptheme")):
        v = d.get(key, "")
        if v and NAME_OK.match(v) and shutil.which(tool):
            run(job, [tool, v])
    for v in ("gtk-3.0", "gtk-4.0"):
        strip_marked(HOME / ".config" / v / "gtk.css")
    prev.unlink()
    job.log("Reverted to your previous look.")


def job_bundle(job, req):
    bid = str(req.get("id", ""))
    bundle = BUNDLE_MAP.get(bid)
    if not bundle:
        raise RuntimeError("unknown bundle")
    job.log("Installing bundle: " + bundle[1])
    job_install(job, bundle[4])


# ------------------------------------------------------------------ GitHub apps
# ARCHMIG_GH_API only exists so the API can be pointed at a test server. Downloads are
# still restricted to github.com / *.githubusercontent.com by gh_url_ok().
GH_API = os.environ.get("ARCHMIG_GH_API", "https://api.github.com")
GH_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,100}/[A-Za-z0-9_.\-]{1,100}$")
GH_REG = THEME_DIR / "github-apps.json"
KIND_ORDER = {"pacman": 0, "appimage": 1, "archive": 2}
SKIP_SUFFIX = (".sha256", ".sha512", ".sha256sum", ".sig", ".asc", ".txt", ".md5", ".sbom", ".json", ".yml",
               ".yaml", ".blockmap", ".zsync", ".pem", ".cert", ".minisig", ".sum", ".md", ".deb", ".rpm",
               ".exe", ".msi", ".dmg", ".apk", ".pkg", ".snap", ".flatpak", ".nupkg", ".jar", ".whl")
BAD_OS = re.compile(r"(^|[^a-z])(win|win32|win64|windows|macos|darwin|osx|mac|android|ios)([^a-z0-9]|$)")
BAD_ARCH = re.compile(r"(arm64|aarch64|armv7|armv6|armhf|arm32|i386|i686|x86(?![_\-]?64)|ppc64|riscv|s390x|loong)")


def parse_gh(s):
    s = (s or "").strip()
    m = re.match(r"^(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+?)(?:\.git)?(?:[/?#].*)?$", s)
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    if GH_RE.match(s) and not s.startswith(("http", "/", ".")):
        return s
    return None


def gh_get(path, timeout=15):
    h = {"Accept": "application/vnd.github+json", "User-Agent": "arch-migrate",
         "X-GitHub-Api-Version": "2022-11-28"}
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        h["Authorization"] = "Bearer " + tok
    try:
        with urllib.request.urlopen(urllib.request.Request(GH_API + path, headers=h), timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise RuntimeError("GitHub is rate limiting you (60 requests/hour without a token). "
                               "Wait a bit, or start the app with GITHUB_TOKEN set.")
        if e.code == 404:
            raise RuntimeError("Not found on GitHub")
        raise RuntimeError(f"GitHub returned {e.code}")
    except Exception as e:  # noqa
        raise RuntimeError("Couldn't reach GitHub: " + str(e))


def classify_asset(name):
    n = name.lower()
    if n.endswith(SKIP_SUFFIX) or BAD_OS.search(n) or BAD_ARCH.search(n):
        return None
    if re.search(r"\.pkg\.tar\.(zst|xz|gz)$", n):
        return "pacman"
    if n.endswith(".appimage"):
        return "appimage"
    if n.endswith((".tar.gz", ".tgz", ".tar.xz", ".tar.zst", ".tar.bz2", ".zip")):
        return "archive"
    return None


def fingerprint(name):
    return re.sub(r"\d+(?:\.\d+)*", "#", name.lower())


def repo_card(i):
    return {"repo": i["full_name"], "desc": i.get("description") or "", "stars": i.get("stargazers_count", 0),
            "lang": i.get("language") or "", "license": (i.get("license") or {}).get("spdx_id") or "",
            "updated": (i.get("pushed_at") or "")[:10], "archived": bool(i.get("archived")),
            "url": i.get("html_url", ""), "branch": i.get("default_branch", "main")}


def gh_search(q):
    q = q.strip()
    if not q:
        return []
    direct = parse_gh(q)
    if direct:
        return [repo_card(gh_get(f"/repos/{direct}"))]
    d = gh_get("/search/repositories?q=" + urllib.parse.quote(q) + "&sort=stars&order=desc&per_page=24")
    return [repo_card(i) for i in d.get("items", [])]


def gh_release(repo):
    r = gh_get(f"/repos/{repo}/releases/latest")
    assets = []
    for a in r.get("assets", []):
        k = classify_asset(a.get("name", ""))
        if k:
            assets.append({"name": a["name"], "kind": k, "size": a.get("size", 0), "digest": a.get("digest") or "",
                           "url": a.get("browser_download_url", "")})
    assets.sort(key=lambda a: (KIND_ORDER[a["kind"]],
                               0 if re.search(r"x86[_\-]64|amd64|linux", a["name"].lower()) else 1, a["name"]))
    return {"tag": r.get("tag_name", ""), "name": r.get("name") or r.get("tag_name", ""),
            "date": (r.get("published_at") or "")[:10], "assets": assets, "notes": (r.get("body") or "")[:700]}


def gh_info(repo):
    if not GH_RE.match(repo):
        raise RuntimeError("That doesn't look like owner/repo")
    out = repo_card(gh_get(f"/repos/{repo}"))
    out["release"], out["pkgbuild"] = None, False
    try:
        out["release"] = gh_release(repo)
    except RuntimeError:
        pass
    try:
        gh_get(f"/repos/{repo}/contents/PKGBUILD")
        out["pkgbuild"] = True
    except RuntimeError:
        pass
    return out


def gh_pkgbuild(repo):
    if not GH_RE.match(repo):
        raise RuntimeError("bad repo")
    d = gh_get(f"/repos/{repo}/contents/PKGBUILD")
    text = base64.b64decode(d.get("content", "")).decode("utf-8", "replace")
    return {"text": text, "sha": hashlib.sha256(text.encode()).hexdigest()}


def pick_asset(rel, name=None, fp=None, kind=None):
    A = rel["assets"]
    for key, val in (("name", name), ("fp", fp), ("kind", kind)):
        if not val:
            continue
        for a in A:
            if (key == "name" and a["name"] == val) or (key == "fp" and fingerprint(a["name"]) == val) \
                    or (key == "kind" and a["kind"] == val):
                return a
    return A[0] if A and not (name or fp or kind) else None


def gh_url_ok(url):
    u = urllib.parse.urlparse(url)
    h = u.hostname or ""
    return u.scheme == "https" and (h == "github.com" or h.endswith(".githubusercontent.com"))


def download(job, url, dest, digest=""):
    if not gh_url_ok(url):
        raise RuntimeError("Refusing to download from a non-GitHub address")
    req = urllib.request.Request(url, headers={"User-Agent": "arch-migrate"})
    h, done = hashlib.sha256(), 0
    with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
        if not gh_url_ok(r.geturl()):
            raise RuntimeError("Download was redirected away from GitHub, aborting")
        total = int(r.headers.get("Content-Length") or 0)
        while True:
            b = r.read(1 << 16)
            if not b:
                break
            f.write(b)
            h.update(b)
            done += len(b)
            if total:
                job.progress = min(0.9, done / total * 0.9)
    hexd = h.hexdigest()
    job.log(f"Downloaded {done / 1048576:.1f} MB, sha256 {hexd}")
    if digest.startswith("sha256:"):
        if digest[7:].lower() != hexd:
            os.unlink(dest)
            raise RuntimeError("SHA-256 doesn't match the digest GitHub published, file discarded")
        job.log("SHA-256 matches GitHub's published digest.")
    else:
        job.log("GitHub published no digest for this file, so it couldn't be verified.")


def reg_load():
    try:
        return json.loads(GH_REG.read_text())
    except Exception:
        return []


def reg_save(L):
    THEME_DIR.mkdir(parents=True, exist_ok=True)
    GH_REG.write_text(json.dumps(L, indent=1))


def reg_put(entry):
    reg_save([e for e in reg_load() if e["repo"] != entry["repo"]] + [entry])


def slug_of(repo):
    return re.sub(r"[^a-z0-9._-]", "-", repo.split("/")[1].lower())


def is_elf(p):
    try:
        with open(p, "rb") as f:
            return f.read(4) == b"\x7fELF"
    except OSError:
        return False


def extract_archive(src, dst):
    n = src.name.lower()
    if n.endswith(".zip"):
        with zipfile.ZipFile(src) as z:
            root = dst.resolve()
            for info in z.infolist():
                t = (dst / info.filename).resolve()
                if root != t and root not in t.parents:
                    raise RuntimeError("Archive contains an unsafe path, aborting")
                z.extract(info, dst)
                mode = (info.external_attr >> 16) & 0o777
                if mode and not info.is_dir():
                    os.chmod(t, mode | 0o200)
    else:
        with tarfile.open(src) as t:
            try:
                t.extractall(dst, filter="data")
            except TypeError:
                for m in t.getmembers():
                    p = (dst / m.name).resolve()
                    if dst.resolve() not in p.parents and p != dst.resolve():
                        raise RuntimeError("Archive contains an unsafe path, aborting")
                t.extractall(dst)


def under(p, parent):
    try:
        return Path(p).resolve().is_relative_to(Path(parent).resolve())
    except Exception:
        return False


def gh_cleanup(old, keep):
    """Remove files a previous install of the same repo left behind (only inside our own folders)."""
    if not old or old.get("mode") != "asset":
        return
    p = old.get("path")
    if p and p != keep.get("path") and under(p, HOME / "Applications") and os.path.isfile(p):
        os.unlink(p)
    d = old.get("dir")
    if d and d != keep.get("dir") and under(d, HOME / ".local/opt") and os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)


def gh_install_asset(job, repo, name=None, fp=None, kind=None):
    job.step = "Looking up release"
    rel = gh_release(repo)
    a = pick_asset(rel, name, fp, kind)
    if not a:
        raise RuntimeError("This release has no file that runs on Arch (x86_64 Linux): "
                           "no package, AppImage or archive found")
    job.log(f"{repo} {rel['tag']}: {a['name']} ({a['size'] / 1048576:.1f} MB, {a['kind']})")
    work = Path(tempfile.mkdtemp(prefix="gh-", dir=TMP))
    safe = re.sub(r"[^A-Za-z0-9._+\-]", "_", Path(a["name"]).name)
    f = work / safe
    job.step = "Downloading"
    download(job, a["url"], f, a.get("digest", ""))
    job.progress = 0.92
    slug = slug_of(repo)
    old = next((e for e in reg_load() if e["repo"] == repo), None)
    entry = {"repo": repo, "mode": "asset", "tag": rel["tag"], "kind": a["kind"], "fp": fingerprint(a["name"]),
             "asset": a["name"], "installed": datetime.datetime.now().isoformat(timespec="seconds")}
    job.step = "Installing"
    k = a["kind"]
    if k == "pacman":
        info = lines(["pacman", "-Qp", str(f)])
        entry["pkg"] = info[0].split()[0] if info else ""
        job.log("Note: this package comes straight from the project and isn't signed by Arch.")
        if run(job, ["sudo", "pacman", "-U", "--noconfirm", str(f)]) != 0:
            raise RuntimeError("pacman could not install the package")
    elif k == "appimage":
        if not lines(["pacman", "-Qq", "fuse2"]):
            job.log("AppImages need fuse2, installing it…")
            if run(job, ["sudo", "pacman", "-S", "--needed", "--noconfirm", "fuse2"]) != 0:
                job.log("! couldn't install fuse2, the AppImage may not start")
        appdir = HOME / "Applications"
        appdir.mkdir(exist_ok=True)
        dest = appdir / safe
        shutil.move(str(f), dest)
        dest.chmod(0o755)
        desk = HOME / ".local/share/applications" / f"archmig-{slug}.desktop"
        desk.parent.mkdir(parents=True, exist_ok=True)
        desk.write_text("[Desktop Entry]\nType=Application\nName=%s\nExec=\"%s\" %%U\nIcon=application-x-executable\n"
                        "Terminal=false\nCategories=Utility;\nComment=Installed from GitHub (%s)\n"
                        % (repo.split("/")[1], dest, repo))
        entry.update({"path": str(dest), "desktop": str(desk)})
        if shutil.which("update-desktop-database"):
            subprocess.run(["update-desktop-database", str(desk.parent)], capture_output=True)
        job.log(f"Installed to {dest} and added to your app menu.")
    else:
        base = HOME / ".local/opt" / slug
        if base.exists():
            shutil.rmtree(base)
        base.mkdir(parents=True)
        extract_archive(f, base)
        kids = list(base.iterdir())
        if len(kids) == 1 and kids[0].is_dir():
            top = kids[0]
            for c in list(top.iterdir()):
                shutil.move(str(c), base / c.name)
            top.rmdir()
        execs = [p for p in base.rglob("*") if p.is_file() and os.access(p, os.X_OK) and is_elf(p)]
        entry["dir"] = str(base)
        if execs:
            want = repo.split("/")[1].lower()
            execs.sort(key=lambda p: (0 if p.name.lower() == want else 1 if want in p.name.lower() else 2,
                                      len(p.relative_to(base).parts), -p.stat().st_size))
            binp = HOME / ".local/bin" / execs[0].name
            binp.parent.mkdir(parents=True, exist_ok=True)
            if binp.is_symlink() or binp.exists():
                binp.unlink()
            binp.symlink_to(execs[0])
            entry["bin"] = str(binp)
            job.log(f"Extracted to {base}\nLinked {binp} -> {execs[0]}")
            if str(binp.parent) not in os.environ.get("PATH", "").split(":"):
                job.log("Tip: ~/.local/bin isn't on your PATH yet; add it to your shell profile to run it by name.")
        else:
            job.log(f"Extracted to {base} (no executable found to link, look inside).")
    gh_cleanup(old, entry)
    reg_put(entry)
    job.log("Done.")


def gh_install_pkgbuild(job, repo, sha):
    for t in ("git",):
        pass
    job.step = "Preparing build tools"
    if run(job, ["sudo", "pacman", "-S", "--needed", "--noconfirm", "base-devel", "git"]) != 0:
        raise RuntimeError("couldn't install base-devel and git")
    work = Path(tempfile.mkdtemp(prefix="gh-", dir=TMP))
    dst = work / "src"
    job.step = "Cloning"
    if run(job, ["git", "clone", "--depth", "1", f"https://github.com/{repo}.git", str(dst)]) != 0:
        raise RuntimeError("git clone failed")
    pb = dst / "PKGBUILD"
    if not pb.exists():
        raise RuntimeError("No PKGBUILD found in the repo")
    if hashlib.sha256(pb.read_text(errors="replace").encode()).hexdigest() != sha:
        raise RuntimeError("The PKGBUILD changed since you reviewed it, nothing was built. Open it again to re-review.")
    job.step = "Building"
    if run(job, ["makepkg", "-si", "--noconfirm"], cwd=dst) != 0:
        raise RuntimeError("makepkg failed")
    pk = next((p for p in dst.glob("*.pkg.tar.*") if not p.name.endswith(".sig")), None)
    info = lines(["pacman", "-Qp", str(pk)]) if pk else []
    commit = lines(["git", "-C", str(dst), "rev-parse", "--short", "HEAD"])
    reg_put({"repo": repo, "mode": "pkgbuild", "kind": "pkgbuild", "tag": commit[0] if commit else "",
             "pkg": info[0].split()[0] if info else "",
             "installed": datetime.datetime.now().isoformat(timespec="seconds")})
    job.log("Done.")


def gh_clone(job, repo):
    if not shutil.which("git"):
        raise RuntimeError("git isn't installed (sudo pacman -S git)")
    dst = HOME / "Projects" / "github" / repo.split("/")[1]
    job.step = "Cloning"
    if (dst / ".git").exists():
        if run(job, ["git", "-C", str(dst), "pull", "--ff-only"]) != 0:
            raise RuntimeError("git pull failed")
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if run(job, ["git", "clone", "--depth", "1", f"https://github.com/{repo}.git", str(dst)]) != 0:
            raise RuntimeError("git clone failed")
    reg_put({"repo": repo, "mode": "clone", "kind": "clone", "tag": "", "path": str(dst),
             "installed": datetime.datetime.now().isoformat(timespec="seconds")})
    job.log(f"Source is in {dst}")


def job_gh_install(job, req):
    repo = str(req.get("repo", ""))
    if not GH_RE.match(repo):
        raise RuntimeError("bad repo name")
    mode = req.get("mode")
    if mode == "asset":
        gh_install_asset(job, repo, name=req.get("asset"))
    elif mode == "pkgbuild":
        gh_install_pkgbuild(job, repo, str(req.get("sha", "")))
    elif mode == "clone":
        gh_clone(job, repo)
    else:
        raise RuntimeError("unknown install mode")


def gh_apps_state(check):
    out = []
    for e in reg_load():
        item = dict(e)
        p = e.get("path") or e.get("dir")
        if e.get("mode") in ("pkgbuild",) or e.get("kind") == "pacman":
            item["missing"] = bool(e.get("pkg")) and not lines(["pacman", "-Qq", e["pkg"]])
        else:
            item["missing"] = bool(p) and not os.path.exists(p)
        if check and e.get("mode") == "asset":
            try:
                rel = gh_release(e["repo"])
                item["latest"], item["update"] = rel["tag"], rel["tag"] != e.get("tag")
            except Exception as ex:  # noqa
                item["error"] = str(ex)
        elif check and e.get("mode") == "pkgbuild":
            try:
                c = gh_get(f"/repos/{e['repo']}/commits?per_page=1")
                sha7 = c[0]["sha"][:7] if c else ""
                item["latest"], item["update"] = sha7, bool(sha7) and sha7 != e.get("tag")
            except Exception as ex:  # noqa
                item["error"] = str(ex)
        out.append(item)
    return out


def gh_update(job, repo):
    e = next((x for x in reg_load() if x["repo"] == repo), None)
    if not e:
        raise RuntimeError("Not in your GitHub apps list")
    if e["mode"] == "asset":
        gh_install_asset(job, repo, fp=e.get("fp"), kind=e.get("kind"))
    elif e["mode"] == "clone":
        gh_clone(job, repo)
    else:
        raise RuntimeError("PKGBUILD installs must be re-reviewed: open it from Store → GitHub and install again")


def gh_remove(job, repo):
    e = next((x for x in reg_load() if x["repo"] == repo), None)
    if not e:
        raise RuntimeError("Not in your GitHub apps list")
    if e.get("pkg"):
        if lines(["pacman", "-Qq", e["pkg"]]) and \
                run(job, ["sudo", "pacman", "-Rns", "--noconfirm", e["pkg"]]) != 0:
            raise RuntimeError("pacman could not remove it")
    p = e.get("path")
    if e.get("mode") == "asset" and p and under(p, HOME / "Applications") and os.path.isfile(p):
        os.unlink(p)
        job.log(f"Deleted {p}")
    d = e.get("desktop")
    if d and under(d, HOME / ".local/share/applications") and Path(d).name.startswith("archmig-") and os.path.isfile(d):
        os.unlink(d)
    dd = e.get("dir")
    if dd and under(dd, HOME / ".local/opt") and os.path.isdir(dd):
        shutil.rmtree(dd, ignore_errors=True)
        job.log(f"Deleted {dd}")
    b = e.get("bin")
    if b and Path(b).is_symlink() and Path(b).parent.resolve() == (HOME / ".local/bin").resolve():
        Path(b).unlink()
    if e.get("mode") == "clone":
        job.log(f"Left your source folder alone: {p}")
    reg_save([x for x in reg_load() if x["repo"] != repo])
    job.log("Removed.")


# ------------------------------------------------------------------ AUR details / bundle contents
def aur_info(name):
    if not NAME_OK.match(name):
        raise RuntimeError("bad package name")
    url = "https://aur.archlinux.org/rpc/v5/info?arg[]=" + urllib.parse.quote(name)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "arch-migrate"}),
                                    timeout=12) as r:
            res = json.load(r).get("results", [])
    except Exception as e:  # noqa
        raise RuntimeError("Couldn't reach the AUR: " + str(e))
    if not res:
        raise RuntimeError("Not found on the AUR")
    x = res[0]
    return {"src": "aur", "name": x["Name"], "ver": x.get("Version", ""), "desc": x.get("Description") or "",
            "maint": x.get("Maintainer") or "", "votes": x.get("NumVotes", 0),
            "pop": round(x.get("Popularity", 0), 2), "ood": x.get("OutOfDate"), "url": x.get("URL") or "",
            "modified": x.get("LastModified"), "first": x.get("FirstSubmitted"),
            "license": ", ".join(x.get("License", [])), "depends": x.get("Depends", []),
            "make": x.get("MakeDepends", [])}


def pkg_info(name, src):
    if not NAME_OK.match(name):
        raise RuntimeError("bad package name")
    if src == "aur":
        return aur_info(name)
    out = subprocess.run(["pacman", "-Si", name], capture_output=True, text=True, timeout=30,
                         env={**os.environ, "LC_ALL": "C"}).stdout
    L = parse_qi(out)
    if not L:
        raise RuntimeError("No details found")
    f = L[0]
    return {"src": f.get("Repository", src), "name": f["Name"], "ver": f.get("Version", ""),
            "desc": f.get("Description", ""), "url": f.get("URL", ""), "license": f.get("Licenses", ""),
            "size": parse_size(f.get("Installed Size", "")), "dl": parse_size(f.get("Download Size", "")),
            "depends": f.get("Depends On", "").split() if f.get("Depends On", "None") != "None" else [],
            "maint": f.get("Packager", "")}


def pkgbuild_text(name):
    if not NAME_OK.match(name):
        raise RuntimeError("bad package name")
    if shutil.which("yay"):
        r = subprocess.run(["yay", "-Gp", name], capture_output=True, text=True, timeout=45)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
    if shutil.which("git"):
        d = Path(tempfile.mkdtemp(prefix="pb-", dir=TMP))
        r = subprocess.run(["git", "clone", "--depth", "1", f"https://aur.archlinux.org/{name}.git", str(d / "x")],
                           capture_output=True, text=True, timeout=60)
        if r.returncode == 0 and (d / "x/PKGBUILD").exists():
            return (d / "x/PKGBUILD").read_text(errors="replace")
    raise RuntimeError("Couldn't fetch the PKGBUILD (needs yay or git, and network)")


def bundle_detail(bid):
    bd = BUNDLE_MAP.get(bid)
    if not bd:
        raise RuntimeError("unknown bundle")
    names = bd[4]
    inst = installed_set()
    sync = set(lines(["pacman", "-Slq"]))
    env = {**os.environ, "LC_ALL": "C"}
    meta = {}
    for flag, group in (("-Si", [n for n in names if n in sync]), ("-Qi", [n for n in names if n in inst])):
        if group:
            try:
                out = subprocess.run(["pacman", flag] + group, capture_output=True, text=True, timeout=60, env=env).stdout
                for f in parse_qi(out):
                    meta.setdefault(f["Name"], f)
            except Exception:
                pass
    pk = []
    for n in names:
        f = meta.get(n, {})
        pk.append({"n": n, "desc": f.get("Description", ""), "repo": f.get("Repository", ""),
                   "size": parse_size(f.get("Installed Size", "")), "installed": n in inst,
                   "found": n in sync or n in inst})
    return {"id": bid, "title": bd[1], "desc": bd[3], "pkgs": pk, "synced": bool(sync)}

# ------------------------------------------------------------------ http
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype="application/json", code=200):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _guard(self):
        host = self.headers.get("Host", "").rsplit(":", 1)[0]
        if host not in ("127.0.0.1", "localhost"):
            self._send({"error": "bad host"}, code=403)
            return False
        return True

    def do_GET(self):
        if not self._guard():
            return
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if u.path == "/":
            return self._send(INDEX.replace("__TOKEN__", TOKEN), "text/html")
        if not u.path.startswith("/api/") or self.headers.get("X-Token") != TOKEN:
            return self._send({"error": "forbidden"}, code=403)
        try:
            self._send(self.get(u.path[5:], q))
        except Exception as e:  # noqa
            self._send({"error": str(e)}, code=500)

    def do_POST(self):
        if not self._guard():
            return
        if self.headers.get("X-Token") != TOKEN:
            return self._send({"error": "forbidden"}, code=403)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            self._send(self.post(self.path[5:], body))
        except Busy as e:
            self._send({"error": str(e)}, code=409)
        except Exception as e:  # noqa
            self._send({"error": str(e)}, code=500)

    def get(self, path, q):
        if path == "status":
            return {"yay": bool(shutil.which("yay")), "user": USER, "host": socket.gethostname(),
                    "os": pretty_os(), "zstd": bool(shutil.which("zstd")), "authed": AUTHED,
                    "downloads": str(downloads_dir()), "home": str(HOME),
                    "busy": bool(CURRENT and CURRENT.status == "running")}
        if path == "scan":
            return do_scan()
        if path == "sizes":
            return {"sizes": dict(SIZES), "done": SIZE_STATE["done"]}
        if path == "backups":
            d = Path(os.path.expanduser(q.get("dir") or str(downloads_dir())))
            if not d.is_dir():
                raise RuntimeError(f"Folder not found: {d}")
            return {"dir": str(d), "items": list_backups(d)}
        if path == "overview":
            return overview()
        if path == "services":
            return service_state()
        if path == "bundles":
            inst = installed_set()
            return [{"id": b[0], "title": b[1], "icon": b[2], "desc": b[3],
                     "pkgs": b[4], "have": sum(1 for n in b[4] if n in inst)} for b in BUNDLES]
        if path == "inventory":
            return inventory()
        if path == "themeinfo":
            return theme_info()
        if path == "ghsearch":
            return gh_search(q.get("q", ""))
        if path == "ghrelease":
            repo = q.get("repo", "")
            if not GH_RE.match(repo):
                raise RuntimeError("That doesn't look like owner/repo")
            return gh_release(repo)
        if path == "ghinfo":
            return gh_info(q.get("repo", ""))
        if path == "ghpkgbuild":
            return gh_pkgbuild(q.get("repo", ""))
        if path == "ghapps":
            return gh_apps_state(q.get("check", "").lower() in ("1", "true", "yes"))
        if path == "pkginfo":
            return pkg_info(q.get("name", ""), q.get("src", "extra"))
        if path == "pkgbuild":
            return {"text": pkgbuild_text(q.get("name", ""))}
        if path == "bundledetail":
            return bundle_detail(q.get("id", ""))
        if path == "catalog":
            return catalog()
        if path == "search":
            return search(q.get("q", ""))
        if path == "job":
            j = JOBS.get(q.get("id"))
            if not j:
                raise RuntimeError("unknown job")
            since = int(q.get("since", 0))
            return {"lines": j.lines[since:], "n": len(j.lines), "status": j.status,
                    "progress": j.progress, "step": j.step, "result": j.result}
        raise RuntimeError("unknown endpoint")

    def post(self, path, b):
        global PASSWORD, AUTHED
        if path == "auth":
            PASSWORD = b.get("password", "")
            env = child_env()
            subprocess.run(["/usr/bin/sudo", "-k"], env=env)
            r = subprocess.run(["/usr/bin/sudo", "-A", "-v"], env=env, capture_output=True, timeout=60)
            AUTHED = r.returncode == 0
            if not AUTHED:
                PASSWORD = None
            return {"ok": AUTHED}
        if path == "backup":
            return {"id": start_job("Backup", job_backup, b).id}
        if path == "restore":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            return {"id": start_job("Restore", job_restore, b).id}
        if path == "install":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            names = [n for n in b.get("names", []) if NAME_OK.match(n)]
            if not names:
                raise RuntimeError("nothing to install")
            return {"id": start_job("Install", job_install, names).id}
        if path == "removeplan":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            return {"plan": remove_plan(b.get("names", []))}
        if path == "manage":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            return {"id": start_job("Manage", job_manage, b).id}
        if path == "bundle":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            return {"id": start_job("Install bundle", job_bundle, b).id}
        if path == "theme":
            return {"id": start_job("Apply theme", job_theme, b).id}
        if path == "themerevert":
            return {"id": start_job("Revert theme", job_theme_revert, b).id}
        if path == "ghinstall":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            return {"id": start_job("Install GitHub app", job_gh_install, b).id}
        if path == "ghupdate":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            repo = str(b.get("repo", ""))
            return {"id": start_job("Update GitHub app", gh_update, repo).id}
        if path == "ghremove":
            if not AUTHED:
                raise RuntimeError("Unlock sudo first")
            repo = str(b.get("repo", ""))
            return {"id": start_job("Remove GitHub app", gh_remove, repo).id}
        if path == "quit":
            threading.Timer(0.3, lambda: os._exit(0)).start()
            return {"ok": True}
        raise RuntimeError("unknown endpoint")


# ------------------------------------------------------------------ UI
INDEX = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arch Migrate</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0&family=Roboto+Flex:opsz,wght@8..144,300..800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
html{font-family:'Roboto Flex',system-ui,sans-serif;font-size:15px}
body{background:var(--bg);color:var(--on);min-height:100vh;transition:background .3s}
.ms{font-family:'Material Symbols Rounded';font-weight:400;font-style:normal;font-size:24px;line-height:1;display:inline-block;letter-spacing:normal;text-transform:none;white-space:nowrap;font-feature-settings:'liga';-webkit-font-feature-settings:'liga';font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;vertical-align:middle;user-select:none;width:1em;overflow:hidden}
.noicons .ms{visibility:hidden}
.ms.fill{font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24}
.app{display:grid;grid-template-columns:96px 1fr;min-height:100vh}
.rail{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 0;background:var(--bg)}
.rail .logo{width:48px;height:48px;border-radius:16px;background:var(--prc);color:var(--onprc);display:grid;place-items:center;margin-bottom:12px}
.nav{display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:var(--onv);cursor:pointer;font:inherit;font-size:12px;font-weight:500;width:80px;padding:4px 0}
.nav .pill{width:56px;height:32px;border-radius:16px;display:grid;place-items:center;transition:background .2s,width .2s}
.nav:hover .pill{background:color-mix(in srgb,var(--on) 8%,transparent)}
.nav.on{color:var(--on)}.nav.on .pill{background:var(--sec);color:var(--onsec)}
.nav.on .ms{font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24}
.grow{flex:1}
.main{padding:20px 32px 140px;max-width:1120px;width:100%}
.top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;justify-content:flex-end}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--outv);font-size:13px;font-weight:500;color:var(--onv);background:none;font-family:inherit;cursor:default}
.chip.btnlike{cursor:pointer}.chip.btnlike:hover{background:color-mix(in srgb,var(--on) 8%,transparent)}
.chip .ms{font-size:18px}.chip.ok{background:var(--tc);color:var(--ontc);border-color:transparent}
.icon{width:40px;height:40px;border-radius:20px;border:0;background:none;color:var(--onv);cursor:pointer;display:grid;place-items:center}
.icon:hover{background:color-mix(in srgb,var(--on) 8%,transparent)}
h1{font-size:34px;font-weight:500;letter-spacing:-.5px;margin:8px 0 4px}
h2{font-size:18px;font-weight:600}
.sub{color:var(--onv);margin-bottom:20px;max-width:640px;line-height:1.45}
.page{display:none}.page.on{display:block;animation:in .25s}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1}}
.card{background:var(--sc);border-radius:28px;padding:20px 24px;margin-bottom:16px}
.cardhead{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.cardhead .ms{color:var(--pr)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}
.tile{background:var(--prc);color:var(--onprc);border-radius:20px;padding:14px 16px}
.tile b{display:block;font-size:28px;font-weight:600;line-height:1.1}.tile span{font-size:13px;opacity:.85}
.tile.t2{background:var(--sec);color:var(--onsec)}.tile.t3{background:var(--tc);color:var(--ontc)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 24px;border-radius:20px;border:0;background:var(--pr);color:var(--onpr);font:inherit;font-weight:600;font-size:14px;cursor:pointer;position:relative;transition:box-shadow .2s,transform .1s,filter .2s}
.btn:hover{filter:brightness(1.07);box-shadow:0 1px 3px rgba(0,0,0,.3)}.btn:active{transform:scale(.97)}
.btn.tonal{background:var(--sec);color:var(--onsec)}.btn.text{background:none;color:var(--pr);padding:0 12px}.btn.text:hover{background:color-mix(in srgb,var(--pr) 10%,transparent);box-shadow:none}
.btn.outlined{background:none;color:var(--pr);border:1px solid var(--ol)}.btn.big{height:56px;border-radius:28px;padding:0 32px;font-size:16px}
.btn:disabled{opacity:.4;pointer-events:none}.btn .ms{font-size:20px}
.field{width:100%;height:48px;border-radius:24px;border:1px solid var(--outv);background:var(--sch);color:var(--on);font:inherit;padding:0 20px;outline:0;transition:border .2s,box-shadow .2s}
.field:focus{border-color:var(--pr);box-shadow:0 0 0 1px var(--pr)}
.search{display:flex;align-items:center;gap:12px;background:var(--sch);border-radius:28px;height:56px;padding:0 20px;margin-bottom:16px}
.search input{flex:1;background:none;border:0;outline:0;font:inherit;font-size:16px;color:var(--on)}.search .ms{color:var(--onv)}
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px}.toolbar .field{height:40px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.tab{height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--ol);background:none;color:var(--onv);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.tab.on{background:var(--sec);color:var(--onsec);border-color:transparent}.tab b{font-weight:600;margin-left:4px}
.list{max-height:340px;overflow:auto;border-radius:16px}
.row{display:flex;align-items:center;gap:12px;padding:7px 12px;border-radius:14px;cursor:pointer;min-height:40px}
.row:hover{background:color-mix(in srgb,var(--on) 7%,transparent)}
.row input{accent-color:var(--pr);width:18px;height:18px;flex:none}
.row span.grow small{display:block;color:var(--onv);font-size:12px;margin-top:1px}.row b{font-weight:500}
.sz{font-size:12px;color:var(--onv);font-variant-numeric:tabular-nums}
.group{margin-bottom:6px}.group>summary{list-style:none;display:flex;align-items:center;gap:8px;padding:10px 6px;cursor:pointer;font-weight:600}
.group>summary::-webkit-details-marker{display:none}.group>summary .ms{transition:transform .2s}.group[open]>summary .ms.ch{transform:rotate(90deg)}
.empty{padding:20px;color:var(--onv);text-align:center}
.sw{display:flex;align-items:center;gap:14px;padding:8px 0;cursor:pointer}
.sw input{display:none}.sw .tr{width:52px;height:32px;border-radius:16px;border:2px solid var(--ol);background:var(--sch);position:relative;flex:none;transition:.2s}
.sw .tr::after{content:'';position:absolute;left:6px;top:6px;width:16px;height:16px;border-radius:50%;background:var(--ol);transition:.2s}
.sw input:checked+.tr{background:var(--pr);border-color:var(--pr)}.sw input:checked+.tr::after{left:24px;top:4px;width:24px;height:24px;background:var(--onpr)}
.sw div small{display:block;color:var(--onv);font-size:12px}
.bk{display:flex;gap:14px;align-items:center;padding:14px 16px;border-radius:20px;border:1px solid var(--outv);margin-bottom:10px;cursor:pointer;transition:.2s}
.bk:hover{background:color-mix(in srgb,var(--on) 6%,transparent)}.bk.on{background:var(--prc);color:var(--onprc);border-color:transparent}
.bk .ms{font-size:32px}.bk small{display:block;opacity:.75;margin-top:2px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.fc{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;background:var(--sec);color:var(--onsec);font-size:13px}
.fc button{border:0;background:none;color:inherit;cursor:pointer;display:grid}.fc .ms{font-size:16px}
.cats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.app-card{background:var(--sc);border-radius:24px;padding:16px;display:flex;flex-direction:column;gap:10px;transition:.2s}
.app-card:hover{background:var(--sch)}.app-card.sel{outline:2px solid var(--pr)}
.app-card .ic{width:44px;height:44px;border-radius:14px;background:var(--prc);color:var(--onprc);display:grid;place-items:center}
.app-card .tt{font-weight:600;font-size:16px}.app-card p{color:var(--onv);font-size:13px;line-height:1.35;flex:1}
.app-card code{font-size:11px;color:var(--onv);opacity:.8}.app-card .f{display:flex;align-items:center;gap:8px;justify-content:space-between}
.sec-t{font-size:13px;font-weight:600;color:var(--pr);letter-spacing:.5px;text-transform:uppercase;margin:20px 4px 10px}
.dock{position:fixed;left:50%;bottom:16px;transform:translate(-50%,140%);width:min(780px,calc(100% - 32px));background:var(--sch);border-radius:28px;box-shadow:0 8px 32px rgba(0,0,0,.35);padding:16px 20px;transition:transform .35s cubic-bezier(.2,.8,.2,1);z-index:20}
.dock.show{transform:translate(-50%,0)}
.dock .h{display:flex;align-items:center;gap:12px}.dock .h b{font-weight:600}
.prog{height:8px;border-radius:4px;background:var(--sec);overflow:hidden;margin:12px 0}.prog i{display:block;height:100%;background:var(--pr);border-radius:4px;transition:width .4s;width:0}
.dock pre{max-height:240px;overflow:auto;background:var(--bg);color:var(--onv);border-radius:16px;padding:12px 14px;font:12px/1.5 ui-monospace,'JetBrains Mono',monospace;white-space:pre-wrap;word-break:break-word}
.dock.min pre,.dock.min .prog{display:none}
.basket{position:fixed;left:50%;bottom:16px;transform:translate(-50%,160%);background:var(--prc);color:var(--onprc);border-radius:28px;padding:10px 12px 10px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 8px 32px rgba(0,0,0,.3);transition:transform .3s;z-index:15}
.basket.show{transform:translate(-50%,0)}
.snack{position:fixed;left:50%;top:20px;transform:translate(-50%,-200%);background:var(--on);color:var(--bg);padding:12px 20px;border-radius:14px;z-index:40;transition:transform .3s;max-width:90vw}
.snack.show{transform:translate(-50%,0)}
dialog{border:0;border-radius:28px;background:var(--sch);color:var(--on);padding:28px;width:min(400px,92vw);margin:auto}
dialog::backdrop{background:rgba(0,0,0,.5);backdrop-filter:blur(3px)}
dialog h2{margin-bottom:8px}dialog p{color:var(--onv);font-size:14px;margin-bottom:16px;line-height:1.4}
.dact{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.err{color:var(--err);font-size:13px;margin-top:8px;min-height:16px}
.swatches{display:flex;gap:6px;align-items:center}.sw-c{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer}.sw-c.on{border-color:var(--on)}
@media(max-width:760px){.app{grid-template-columns:1fr}.rail{position:fixed;bottom:0;left:0;right:0;top:auto;height:76px;flex-direction:row;justify-content:space-around;padding:8px;background:var(--sc);z-index:30}
.rail .logo,.rail .grow{display:none}.nav{width:auto;flex:1}.main{padding:12px 16px 190px}.dock{bottom:92px}.basket{bottom:92px}h1{font-size:28px}}
.tile small{display:block;font-size:12px;opacity:.75;margin-top:4px}
.tile .ms{font-size:22px;opacity:.8;margin-bottom:6px}
.meter{height:6px;border-radius:3px;background:color-mix(in srgb,currentColor 18%,transparent);margin-top:8px;overflow:hidden}.meter i{display:block;height:100%;background:currentColor;border-radius:3px}
select.field{appearance:none;cursor:pointer;padding-right:36px;background-image:linear-gradient(45deg,transparent 50%,var(--onv) 50%),linear-gradient(135deg,var(--onv) 50%,transparent 50%);background-position:calc(100% - 20px) 20px,calc(100% - 15px) 20px;background-size:5px 5px;background-repeat:no-repeat}
.badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;font-size:11px;font-weight:600;background:var(--sec);color:var(--onsec);margin-left:6px}
.badge.aur{background:var(--tc);color:var(--ontc)}.badge.warn{background:color-mix(in srgb,var(--err) 25%,transparent);color:var(--err)}
.row.locked{opacity:.5;cursor:not-allowed}
.row .ms.lk{font-size:18px;color:var(--onv)}
.prev{margin-top:14px;border-radius:24px;padding:16px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.prev .pw{flex:1;min-width:220px;border-radius:18px;padding:14px}.prev .pb{display:inline-block;border-radius:20px;padding:8px 18px;font-weight:600;font-size:13px;margin:8px 6px 0 0}
.prev .dot{width:28px;height:28px;border-radius:50%;display:inline-block;margin-right:6px;border:1px solid rgba(128,128,128,.3)}
.svc{display:flex;align-items:center;gap:14px;padding:6px 0}.svc .sw{flex:1;padding:4px 0}
.svc .st{font-size:12px;color:var(--onv)}.svc.off{opacity:.55}
.bundle .f{display:flex;align-items:center;justify-content:space-between;gap:8px}
#mg-bar{background:var(--errc,var(--prc))}

/* GitHub app panel */
#gh-results,#gh-installed{margin-top:12px}
#gh-search-note{font-size:12px;margin:10px 0;color:var(--onv)}
#gh-q{flex:1;min-width:120px}
#gh-search{white-space:nowrap}
</style></head><body>
<div class="app">
<nav class="rail">
 <div class="logo"><span class="ms fill">swap_horiz</span></div>
 <button class="nav on" data-p="overview"><div class="pill"><span class="ms">dashboard</span></div>Overview</button>
 <button class="nav" data-p="backup"><div class="pill"><span class="ms">inventory_2</span></div>Backup</button>
 <button class="nav" data-p="restore"><div class="pill"><span class="ms">restore</span></div>Restore</button>
 <button class="nav" data-p="store"><div class="pill"><span class="ms">storefront</span></div>Store</button>
 <button class="nav" data-p="github"><div class="pill"><span class="ms">hub</span></div>GitHub</button>
 <button class="nav" data-p="manage"><div class="pill"><span class="ms">apps</span></div>Manage</button>
 <button class="nav" data-p="themes"><div class="pill"><span class="ms">palette</span></div>Themes</button>
 <div class="grow"></div>
 <button class="nav" id="quit"><div class="pill"><span class="ms">power_settings_new</span></div>Quit</button>
</nav>
<main class="main">
 <div class="top">
  <span class="chip" id="c-os"><span class="ms">computer</span><span>…</span></span>
  <span class="chip" id="c-yay"><span class="ms">package_2</span><span>yay</span></span>
  <span class="chip btnlike" id="c-lock"><span class="ms">lock</span><span>sudo locked</span></span>
  <div class="swatches" id="swatches"></div>
  <button class="icon" id="darkbtn" title="Light / dark"><span class="ms">contrast</span></button>
 </div>

 <section class="page on" id="p-overview">
  <h1>Overview</h1>
  <p class="sub">Your system at a glance, with one-click upkeep, first-boot bundles and service switches.</p>
  <div class="stats" id="ov-tiles"></div>
  <div class="card" id="ov-upd" style="display:none"><div class="cardhead"><span class="ms">system_update_alt</span><h2>Updates waiting</h2></div><div class="chips" id="ov-upd-list"></div></div>
  <div class="card"><div class="cardhead"><span class="ms">bolt</span><h2>Quick actions</h2></div>
   <div class="chips" style="gap:10px">
    <button class="btn" data-act="update"><span class="ms">system_update_alt</span>Update everything</button>
    <button class="btn tonal" data-act="orphans"><span class="ms">auto_delete</span>Remove orphans</button>
    <button class="btn tonal" data-act="cache"><span class="ms">cleaning_services</span>Clean package cache</button>
    <button class="btn tonal" data-act="mirrors"><span class="ms">speed</span>Refresh mirrors</button>
   </div></div>
  <div class="sec-t">First-boot bundles</div>
  <div class="grid" id="ov-bundles"></div>
  <div class="sec-t">Services</div>
  <div class="card" id="ov-services"></div>
 </section>

 <section class="page" id="p-backup">
  <h1>Backup</h1>
  <p class="sub">Snapshot your apps and files into one archive in Downloads. Pick what to keep, hit create, then copy the file anywhere safe.</p>
  <div class="card"><div class="cardhead"><span class="ms">apps</span><h2>Apps</h2><span class="grow"></span><button class="btn text" id="rescan"><span class="ms">refresh</span>Rescan</button></div>
   <div class="stats" id="bk-stats"></div><div id="bk-pk"></div>
   <p class="sub" style="margin:10px 0 0;font-size:13px">CachyOS-only packages (kernels, cachyos-*, fish config) are unchecked automatically since plain Arch can't install them.</p></div>
  <div class="card"><div class="cardhead"><span class="ms">folder_zip</span><h2>Files &amp; settings</h2><span class="grow"></span><span class="sz" id="bk-total"></span></div>
   <div class="toolbar"><input class="field" id="bk-filter" placeholder="Filter folders and settings…"></div>
   <div id="bk-files" class="list" style="max-height:420px"></div></div>
  <div class="card"><div class="cardhead"><span class="ms">tune</span><h2>Options</h2></div>
   <label class="sw"><input type="checkbox" id="steam"><span class="tr"></span><div>Include Steam game installs<small>Off by default, Steam re-downloads them. Saves, logins and Proton prefixes are always kept.</small></div></label>
   <div class="toolbar" style="margin-top:8px"><input class="field" id="extra-in" placeholder="Add an extra file or folder inside your home (e.g. ~/Games/mods)"><button class="btn tonal" id="extra-add">Add</button></div>
   <div class="chips" id="extras"></div>
   <div class="toolbar" style="margin-top:8px"><span class="ms" style="color:var(--onv)">download</span><input class="field" id="dest" placeholder="Save to…"></div></div>
  <button class="btn big" id="bk-go"><span class="ms">backup</span>Create backup</button>
 </section>

 <section class="page" id="p-restore">
  <h1>Restore</h1>
  <p class="sub">Run this on your fresh Arch install. It finds your backup in Downloads, installs yay, reinstalls every app with auto-yes, and puts your files back.</p>
  <div class="card"><div class="cardhead"><span class="ms">search</span><h2>Backups found</h2><span class="grow"></span><button class="btn text" id="bscan"><span class="ms">refresh</span>Rescan</button></div>
   <div id="bk-list"></div>
   <div class="toolbar"><input class="field" id="bdir" placeholder="Look in another folder…"><button class="btn tonal" id="bdir-go">Scan</button></div></div>
  <div id="rs-cfg" style="display:none">
   <div class="card"><div class="cardhead"><span class="ms">checklist</span><h2>What to restore</h2></div>
    <label class="sw"><input type="checkbox" id="s-multilib" checked><span class="tr"></span><div>Enable multilib<small>Needed for Steam and lib32 packages</small></div></label>
    <label class="sw"><input type="checkbox" id="s-update" checked><span class="tr"></span><div>Update the system first<small>pacman -Syu --noconfirm</small></div></label>
    <label class="sw"><input type="checkbox" id="s-yay" checked><span class="tr"></span><div>Install yay<small>Builds yay-bin from the AUR if it's missing</small></div></label>
    <label class="sw"><input type="checkbox" id="s-native" checked><span class="tr"></span><div>Repo packages<small>pacman -S --needed --noconfirm</small></div></label>
    <label class="sw"><input type="checkbox" id="s-aur" checked><span class="tr"></span><div>AUR packages<small>yay -S --needed --noconfirm</small></div></label>
    <label class="sw"><input type="checkbox" id="s-flatpak" checked><span class="tr"></span><div>Flatpak apps</div></label>
    <label class="sw"><input type="checkbox" id="s-files" checked><span class="tr"></span><div>Files &amp; settings<small>Extracted into your home folder</small></div></label>
    <label class="sw"><input type="checkbox" id="s-keep"><span class="tr"></span><div>Don't overwrite files that already exist</div></label></div>
   <div class="card"><div class="cardhead"><span class="ms">apps</span><h2>Packages in this backup</h2></div><div id="rs-pk"></div></div>
   <button class="btn big" id="rs-go"><span class="ms">rocket_launch</span>Restore everything</button>
  </div>
 </section>

 <section class="page" id="p-store">
  <h1>Store</h1>
  <p class="sub">Browse popular apps or search every repo and the whole AUR. Installs go through yay with no prompts.</p>
  <div class="search"><span class="ms">search</span><input id="q" placeholder="Search apps and packages…" autocomplete="off"></div>
  <div id="st-res" style="display:none"><div class="sec-t">Search results</div><div class="grid" id="st-grid"></div></div>
  <div id="st-cat"><div class="cats" id="cats"></div><div id="cat-body"></div></div>
 </section>
 <section class="page" id="p-github">
  <h1>GitHub apps</h1>
  <p class="sub">Find Linux releases from GitHub, install AppImages, packages or archives, or clone a project's source.</p>
  <div class="card">
   <div class="cardhead"><span class="ms">search</span><h2>Find a project</h2></div>
   <div class="search"><span class="ms">search</span><input class="field" id="gh-q" placeholder="owner/repo or search terms…" autocomplete="off"><button class="btn" id="gh-search">Search</button></div>
   <p class="sub" id="gh-search-note">Install only releases from projects you trust. GitHub release files are third-party downloads.</p>
   <div class="grid" id="gh-results"></div>
  </div>
  <div class="card">
   <div class="cardhead"><span class="ms">inventory_2</span><h2>Installed from GitHub</h2><span class="grow"></span><button class="btn outlined" id="gh-refresh"><span class="ms">refresh</span>Check updates</button></div>
   <div class="grid" id="gh-installed"><div class="empty">Load your installed GitHub apps to see their status.</div></div>
  </div>
 </section>
<section class="page" id="p-manage">
  <h1>Manage</h1>
  <p class="sub">Everything installed on this machine: repo and AUR packages, plus flatpaks. Select, preview what will be removed (including unused dependencies), then confirm.</p>
  <div class="search"><span class="ms">search</span><input id="mg-q" placeholder="Filter installed packages…" autocomplete="off"></div>
  <div class="tabs" id="mg-tabs"></div>
  <div class="tabs" id="mg-filters"></div>
  <div class="card" style="padding:12px 16px">
   <div class="toolbar" style="margin:0 0 6px">
    <span class="sz" id="mg-count"></span><span class="grow"></span>
    <select class="field" id="mg-sort" style="width:auto;height:36px;padding:0 14px"><option value="name">Sort: name</option><option value="size">Sort: size</option></select>
    <button class="btn text" id="mg-clear">Clear</button>
    <button class="btn text" id="mg-reload"><span class="ms">refresh</span>Reload</button>
   </div>
   <div class="list" id="mg-list" style="max-height:none"></div>
  </div>
  <div class="basket" id="mg-bar"><b id="mg-n"></b><button class="btn" id="mg-rm" style="background:var(--err);color:var(--bg)"><span class="ms">delete</span>Remove</button></div>
 </section>
<section class="page" id="p-themes">
  <h1>Themes</h1>
  <p class="sub">Generate a full Material You look for KDE Plasma from one colour: colour scheme, optional wallpaper, GTK apps, icons and cursors. Your previous look is saved so you can revert in one click.</p>
  <div class="card"><div class="cardhead"><span class="ms">palette</span><h2>Accent colour</h2></div>
   <div class="chips" id="th-presets"></div>
   <label style="display:block;margin:12px 0 4px;color:var(--onv);font-size:13px">Hue</label>
   <input type="range" min="0" max="359" id="th-hue" style="width:100%;accent-color:var(--pr)">
   <label style="display:block;margin:12px 0 4px;color:var(--onv);font-size:13px">Vividness (desktop only)</label>
   <input type="range" min="50" max="130" value="100" id="th-vivid" style="width:100%;accent-color:var(--pr)">
   <label class="sw"><input type="checkbox" id="th-dark" checked><span class="tr"></span><div>Dark mode</div></label>
   <div class="prev" id="th-prev"></div></div>
  <div class="card"><div class="cardhead"><span class="ms">tune</span><h2>What to change</h2></div>
   <div id="th-note" class="sub" style="font-size:13px"></div>
   <label class="sw"><input type="checkbox" id="th-wall" checked><span class="tr"></span><div>Generate a matching wallpaper<small>A soft gradient in your colour, saved to ~/.local/share/wallpapers</small></div></label>
   <label class="sw"><input type="checkbox" id="th-gtk" checked><span class="tr"></span><div>Theme GTK apps too<small>Writes colours into gtk-3.0 and gtk-4.0 gtk.css inside a marked block, easily removed</small></div></label>
   <div class="toolbar" style="margin-top:8px"><span class="ms" style="color:var(--onv)">interests</span><select class="field" id="th-icons"></select></div>
   <div class="toolbar"><span class="ms" style="color:var(--onv)">mouse</span><select class="field" id="th-cursor"></select></div>
   <div class="toolbar"><span class="ms" style="color:var(--onv)">web_asset</span><select class="field" id="th-plasma"></select></div>
   <div class="chips" style="margin-top:12px;gap:10px"><button class="btn big" id="th-apply"><span class="ms">auto_awesome</span>Apply to desktop</button><button class="btn outlined" id="th-revert"><span class="ms">undo</span>Revert</button></div></div>
  <div id="th-pk"></div>
 </section>
</main></div>

<div class="dock" id="dock"><div class="h"><span class="ms" id="d-ic">sync</span><b id="d-title"></b><span class="sz" id="d-step"></span><span class="grow"></span><span class="sz" id="d-pct"></span><button class="icon" id="d-min"><span class="ms">expand_more</span></button><button class="icon" id="d-x"><span class="ms">close</span></button></div>
 <div class="prog"><i id="d-bar"></i></div><pre id="d-log"></pre></div>
<div class="basket" id="basket"><b id="b-n"></b><button class="btn text" id="b-clear" style="color:inherit">Clear</button><button class="btn" id="b-go"><span class="ms">download</span>Install</button></div>
<div class="snack" id="snack"></div>
<dialog id="authDlg"><form method="dialog" id="authForm"><h2>Unlock sudo</h2><p>Needed to install packages. Your password stays in memory on this machine only and is never saved.</p>
 <input class="field" type="password" id="pw" placeholder="Password" autocomplete="current-password"><div class="err" id="pw-err"></div>
 <div class="dact"><button type="button" class="btn text" id="pw-cancel">Cancel</button><button class="btn" id="pw-ok">Unlock</button></div></form></dialog>

<script>
const TOKEN="__TOKEN__";
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const S={status:{},scan:null,sizes:{},bk:null,backups:[],rs:null,rsSel:null,cat:[],basket:new Set(),catFilter:'All',extras:[]};
async function api(path,body){const o={headers:{'X-Token':TOKEN}};if(body!==undefined){o.method='POST';o.headers['Content-Type']='application/json';o.body=JSON.stringify(body)}
 const r=await fetch('/api/'+path,o);if(!r.ok){let m=r.statusText;try{m=(await r.json()).error||m}catch(e){}throw new Error(m)}return r.json()}
function fmt(b){if(!b)return '0 B';const u=['B','KB','MB','GB','TB'];let i=0;while(b>=1024&&i<4){b/=1024;i++}return (b>=100||i==0?b.toFixed(0):b.toFixed(1))+' '+u[i]}
let snackT;function toast(m){const s=$('#snack');s.textContent=m;s.classList.add('show');clearTimeout(snackT);snackT=setTimeout(()=>s.classList.remove('show'),3800)}

/* ---------- Material You theme ---------- */
const SEEDS=[['Lavender',265],['Rose',340],['Peach',22],['Sand',48],['Mint',150],['Sky',208]];
let THEME=JSON.parse(localStorage.getItem('am-theme')||'null')||{h:265,dark:matchMedia('(prefers-color-scheme: dark)').matches};
function applyTheme(){const {h,dark}=THEME,r=document.documentElement.style,c=(s,l,hh=h)=>`hsl(${hh} ${s}% ${l}%)`,t=(h+55)%360;
 const T=dark?{bg:c(14,8),sc:c(13,13),sch:c(13,18),on:c(20,90),onv:c(12,76),pr:c(80,80),onpr:c(60,20),prc:c(40,30),onprc:c(90,90),sec:c(25,28),onsec:c(30,90),outv:c(12,28),ol:c(8,56),tc:c(35,28,t),ontc:c(70,90,t),err:'#f2b8b5'}
 :{bg:c(40,98),sc:c(30,94),sch:c(28,91),on:c(15,11),onv:c(10,30),pr:c(48,42),onpr:'#fff',prc:c(90,90),onprc:c(70,15),sec:c(40,89),onsec:c(40,15),outv:c(18,80),ol:c(8,50),tc:c(60,88,t),ontc:c(60,16,t),err:'#b3261e'};
 for(const k in T)r.setProperty('--'+k,T[k]);r.colorScheme=dark?'dark':'light';localStorage.setItem('am-theme',JSON.stringify(THEME));
 $('#swatches').innerHTML=SEEDS.map(([n,hh])=>`<div class="sw-c ${hh===THEME.h?'on':''}" title="${n}" data-h="${hh}" style="background:hsl(${hh} 60% ${dark?70:45}%)"></div>`).join('')}
$('#swatches').onclick=e=>{const h=e.target.dataset.h;if(h){THEME.h=+h;applyTheme()}};
$('#darkbtn').onclick=()=>{THEME.dark=!THEME.dark;applyTheme()};applyTheme();

/* ---------- nav ---------- */
function show(p){$$('.nav[data-p]').forEach(n=>n.classList.toggle('on',n.dataset.p===p));$$('.page').forEach(x=>x.classList.toggle('on',x.id==='p-'+p));
 if(p==='restore'&&!S.backups.length)loadBackups();if(p==='store'&&!S.cat.length)loadCatalog();if(p==='overview')loadOverview().catch(e=>toast(e.message));if(p==='github')loadGhApps(false);if(p==='manage')loadInventory();if(p==='themes')loadThemes();$('#basket').classList.toggle('show',p==='store'&&S.basket.size>0)}
$$('.nav[data-p]').forEach(n=>n.onclick=()=>show(n.dataset.p));
$('#quit').onclick=async()=>{try{await api('quit',{})}catch(e){}document.body.innerHTML='<div style="display:grid;place-items:center;height:100vh;color:var(--onv)">Arch Migrate closed. You can close this window.</div>'};

/* ---------- status & sudo ---------- */
async function refreshStatus(){S.status=await api('status');const s=S.status;
 $('#c-os span:last-child').textContent=`${s.os} · ${s.user}@${s.host}`;
 const y=$('#c-yay');y.classList.toggle('ok',s.yay);y.lastElementChild.textContent=s.yay?'yay ready':'yay will be installed';
 const l=$('#c-lock');l.classList.toggle('ok',s.authed);l.firstElementChild.textContent=s.authed?'lock_open':'lock';l.lastElementChild.textContent=s.authed?'sudo unlocked':'sudo locked'}
$('#c-lock').onclick=()=>ensureAuth();
function ensureAuth(){return new Promise(res=>{if(S.status.authed)return res(true);const d=$('#authDlg');$('#pw').value='';$('#pw-err').textContent='';d.showModal();$('#pw').focus();
 const done=v=>{d.close();res(v)};$('#pw-cancel').onclick=()=>done(false);
 $('#authForm').onsubmit=async e=>{e.preventDefault();$('#pw-ok').disabled=true;$('#pw-err').textContent='';
  try{const r=await api('auth',{password:$('#pw').value});if(r.ok){await refreshStatus();done(true)}else $('#pw-err').textContent='Wrong password, try again.'}catch(x){$('#pw-err').textContent=x.message}$('#pw-ok').disabled=false}})}

/* ---------- job dock ---------- */
const dock=$('#dock');$('#d-min').onclick=()=>dock.classList.toggle('min');$('#d-x').onclick=()=>dock.classList.remove('show');
async function runJob(path,body,title,after){let j;try{j=await api(path,body)}catch(e){toast(e.message);return}
 dock.classList.add('show');dock.classList.remove('min');$('#d-title').textContent=title;$('#d-log').textContent='';$('#d-ic').textContent='sync';$('#d-bar').style.width='0';let since=0;
 for(;;){let r;try{r=await api('job?id='+j.id+'&since='+since)}catch(e){await sleep(1000);continue}
  since=r.n;if(r.lines.length){const p=$('#d-log'),nb=p.scrollTop+p.clientHeight>=p.scrollHeight-40;p.textContent+=r.lines.join('\n')+'\n';if(nb)p.scrollTop=p.scrollHeight}
  $('#d-bar').style.width=Math.round(r.progress*100)+'%';$('#d-pct').textContent=Math.round(r.progress*100)+'%';$('#d-step').textContent=r.step?'· '+r.step:'';
  if(r.status!=='running'){$('#d-ic').textContent=r.status==='done'?'check_circle':'error';toast(title+(r.status==='done'?' finished':' failed'));await refreshStatus();if(after)after(r);return}
  await sleep(700)}}

/* ---------- reusable panels ---------- */
function pkgPanel(mount,lists,sel,onChange){const names={native:'Repo',aur:'AUR / foreign',flatpak:'Flatpak'};
 let tab=['native','aur','flatpak'].find(k=>(lists[k]||[]).length)||'native',q='';
 mount.innerHTML=`<div class="tabs"></div><div class="toolbar"><input class="field" placeholder="Filter packages…"><button class="btn text" data-a="all">All</button><button class="btn text" data-a="none">None</button></div><div class="list"></div>`;
 const tabs=$('.tabs',mount),list=$('.list',mount),inp=$('input',mount);
 const vis=()=>(lists[tab]||[]).filter(n=>n.toLowerCase().includes(q));
 function draw(){tabs.innerHTML=Object.keys(names).map(k=>`<button class="tab ${k===tab?'on':''}" data-k="${k}">${names[k]}<b>${sel[k].size}/${(lists[k]||[]).length}</b></button>`).join('');
  const L=vis();list.innerHTML=L.length?L.map(n=>`<label class="row"><input type="checkbox" data-n="${esc(n)}" ${sel[tab].has(n)?'checked':''}><span class="grow">${esc(n)}</span></label>`).join(''):'<div class="empty">Nothing here</div>'}
 tabs.onclick=e=>{const k=e.target.closest('.tab')?.dataset.k;if(k){tab=k;draw()}};inp.oninput=()=>{q=inp.value.toLowerCase();draw()};
 list.onchange=e=>{const n=e.target.dataset.n;if(n===undefined)return;e.target.checked?sel[tab].add(n):sel[tab].delete(n);drawTabs();onChange&&onChange()};
 const drawTabs=()=>{$$('.tab',tabs).forEach(t=>t.lastElementChild.textContent=`${sel[t.dataset.k].size}/${(lists[t.dataset.k]||[]).length}`)};
 mount.onclick=e=>{const a=e.target.closest('[data-a]')?.dataset.a;if(!a)return;vis().forEach(n=>a==='all'?sel[tab].add(n):sel[tab].delete(n));draw();onChange&&onChange()};draw()}

const GROUPS=[['folders','Your folders'],['dotfiles','Dotfiles & keys'],['config','App settings (~/.config)'],['data','App data (~/.local/share)']];
function filesPanel(mount,items,sel,onChange){let q='';
 function draw(){mount.innerHTML=GROUPS.map(([g,t])=>{const L=items.filter(i=>i.group===g&&(i.label+i.rel).toLowerCase().includes(q));if(!L.length)return '';
  return `<details class="group" open><summary><span class="ms ch">chevron_right</span>${t}<span class="grow"></span><button type="button" class="btn text" data-g="${g}" data-a="all">All</button><button type="button" class="btn text" data-g="${g}" data-a="none">None</button></summary>`+
  L.map(i=>`<label class="row"><input type="checkbox" data-id="${esc(i.id)}" ${sel.has(i.id)?'checked':''}><span class="grow"><b>${esc(i.label)}</b>${i.label!==i.rel&&i.kind==='path'?`<small>${esc(i.rel)}</small>`:''}</span><span class="sz" data-sz="${esc(i.id)}">${S.sizes[i.id]!==undefined?fmt(S.sizes[i.id]):'…'}</span></label>`).join('')+'</details>'}).join('')||'<div class="empty">No matches</div>'}
 mount.onchange=e=>{const id=e.target.dataset.id;if(id===undefined)return;e.target.checked?sel.add(id):sel.delete(id);onChange&&onChange()};
 mount.onclick=e=>{const b=e.target.closest('button[data-g]');if(!b){return}e.preventDefault();e.stopPropagation();
  items.filter(i=>i.group===b.dataset.g&&(i.label+i.rel).toLowerCase().includes(q)).forEach(i=>b.dataset.a==='all'?sel.add(i.id):sel.delete(i.id));draw();onChange&&onChange()};
 mount.refilter=v=>{q=v.toLowerCase();draw()};mount.redraw=draw;draw()}

/* ---------- backup ---------- */
async function loadScan(){$('#bk-stats').innerHTML='<div class="empty" style="grid-column:1/-1">Scanning…</div>';
 const sc=await api('scan');S.scan=sc;S.sizes={};const off=new Set(sc.off);
 S.bk={pk:{native:new Set(sc.packages.native.filter(n=>!off.has(n))),aur:new Set(sc.packages.aur.filter(n=>!off.has(n))),flatpak:new Set(sc.packages.flatpak)},files:new Set(sc.items.filter(i=>i.on).map(i=>i.id))};
 const P=sc.packages;$('#bk-stats').innerHTML=`<div class="tile"><b>${P.native.length}</b><span>repo packages</span></div><div class="tile t2"><b>${P.aur.length}</b><span>AUR / foreign</span></div><div class="tile t3"><b>${P.flatpak.length}</b><span>flatpaks</span></div>`;
 pkgPanel($('#bk-pk'),P,S.bk.pk);const fp=$('#bk-files');filesPanel(fp,sc.items,S.bk.files,updTotal);$('#bk-filter').oninput=e=>fp.refilter(e.target.value);pollSizes()}
function updTotal(){let t=0;S.bk.files.forEach(id=>t+=S.sizes[id]||0);$('#bk-total').textContent='Selected ≈ '+fmt(t)+' before compression'}
async function pollSizes(){for(;;){let r;try{r=await api('sizes')}catch(e){return}S.sizes=r.sizes;for(const [id,v] of Object.entries(r.sizes)){const el=document.querySelector(`[data-sz="${CSS.escape(id)}"]`);if(el)el.textContent=fmt(v)}updTotal();if(r.done)return;await sleep(900)}}
$('#rescan').onclick=loadScan;
$('#extra-add').onclick=()=>{const v=$('#extra-in').value.trim();if(!v)return;S.extras.push(v);$('#extra-in').value='';drawExtras()};
function drawExtras(){$('#extras').innerHTML=S.extras.map((x,i)=>`<span class="fc">${esc(x)}<button data-i="${i}"><span class="ms">close</span></button></span>`).join('')}
$('#extras').onclick=e=>{const i=e.target.closest('button')?.dataset.i;if(i!==undefined){S.extras.splice(+i,1);drawExtras()}};
$('#bk-go').onclick=()=>{if(!S.scan)return;const items=S.scan.items.filter(i=>S.bk.files.has(i.id)).map(i=>({rel:i.rel,kind:i.kind}));
 runJob('backup',{items,extras:S.extras,steam:$('#steam').checked,dest:$('#dest').value,packages:{native:[...S.bk.pk.native],aur:[...S.bk.pk.aur],flatpak:[...S.bk.pk.flatpak]}},'Creating backup',r=>{if(r.status==='done'){S.backups=[]}})};

/* ---------- restore ---------- */
async function loadBackups(dir){const el=$('#bk-list');el.innerHTML='<div class="empty">Looking…</div>';
 try{const r=await api('backups'+(dir?'?dir='+encodeURIComponent(dir):''));S.backups=r.items;$('#bdir').placeholder='Looking in '+r.dir+' · try another folder…';
  el.innerHTML=r.items.length?r.items.map((b,i)=>{const m=b.manifest;return `<div class="bk ${S.rsSel===b.path?'on':''}" data-i="${i}"><span class="ms">${m?'inventory_2':'help'}</span><div class="grow"><b>${esc(b.name)}</b><small>${m?`${esc(m.source_os)} · ${m.native.length+m.aur.length} packages · ${m.flatpak.length} flatpaks · ${m.file_count} files · `:'Could not read manifest · '}${fmt(b.size)} · ${new Date(b.mtime*1000).toLocaleString()}</small></div></div>`}).join(''):`<div class="empty">No arch-migrate backups in ${esc(r.dir)} yet.</div>`}catch(e){el.innerHTML=`<div class="empty">${esc(e.message)}</div>`}}
$('#bscan').onclick=()=>loadBackups();$('#bdir-go').onclick=()=>loadBackups($('#bdir').value.trim()||undefined);
$('#bk-list').onclick=e=>{const c=e.target.closest('.bk');if(!c)return;const b=S.backups[+c.dataset.i];if(!b.manifest){toast('That archive has no readable manifest');return}
 S.rsSel=b.path;S.rs=b;$$('.bk').forEach(x=>x.classList.toggle('on',x===c));const m=b.manifest,off=n=>n.toLowerCase().includes('cachy')||n==='fish'||n==='chwd';
 const sel={native:new Set(m.native.filter(n=>!off(n))),aur:new Set(m.aur.filter(n=>!off(n))),flatpak:new Set(m.flatpak)};S.rsPk=sel;
 pkgPanel($('#rs-pk'),{native:m.native,aur:m.aur,flatpak:m.flatpak},sel);$('#rs-cfg').style.display='block';$('#rs-cfg').scrollIntoView({behavior:'smooth'})};
$('#rs-go').onclick=async()=>{if(!S.rs)return;if(!(await ensureAuth()))return;
 const g=id=>$('#s-'+id).checked;runJob('restore',{archive:S.rs.path,keep:g('keep'),steps:{multilib:g('multilib'),update:g('update'),yay:g('yay'),native:g('native'),aur:g('aur'),flatpak:g('flatpak'),files:g('files')},
  packages:{native:[...S.rsPk.native],aur:[...S.rsPk.aur],flatpak:[...S.rsPk.flatpak]}},'Restoring')};

/* ---------- store ---------- */
async function loadCatalog(){S.cat=await api('catalog');drawCats()}
function appCard(a){const sel=S.basket.has(a.pkg);const btn=a.installed?'<span class="chip ok"><span class="ms">check</span>Installed</span>':`<button class="btn ${sel?'tonal':''}" data-pkg="${esc(a.pkg)}">${sel?'<span class="ms">check</span>Added':'<span class="ms">add</span>Add'}</button>`;
 return `<div class="app-card ${sel?'sel':''}"><div class="ic"><span class="ms">${a.icon||'deployed_code'}</span></div><div><div class="tt">${esc(a.title||a.pkg)}</div><code>${esc(a.pkg)}${a.src?' · '+esc(a.src):''}${a.ver?' · '+esc(a.ver):''}${a.votes?' · ★'+a.votes:''}</code></div><p>${esc(a.desc||'')}</p><div class="f">${btn}</div></div>`}
function drawCats(){const cats=['All',...new Set(S.cat.map(a=>a.cat))];$('#cats').innerHTML=cats.map(c=>`<button class="tab ${c===S.catFilter?'on':''}" data-c="${c}">${c}</button>`).join('');
 const L=S.cat.filter(a=>S.catFilter==='All'||a.cat===S.catFilter);const by={};L.forEach(a=>(by[a.cat]=by[a.cat]||[]).push(a));
 $('#cat-body').innerHTML=Object.entries(by).map(([c,A])=>`<div class="sec-t">${c}</div><div class="grid">${A.map(appCard).join('')}</div>`).join('');bar()}
$('#cats').onclick=e=>{const c=e.target.dataset.c;if(c){S.catFilter=c;drawCats()}};
let lastRes=[];function toggle(pkg){S.basket.has(pkg)?S.basket.delete(pkg):S.basket.add(pkg);drawCats();if($('#st-res').style.display!=='none')drawRes()}
$('#p-store').onclick=e=>{const p=e.target.closest('button[data-pkg]')?.dataset.pkg;if(p)toggle(p)};
function bar(){$('#basket').classList.toggle('show',S.basket.size>0&&$('#p-store').classList.contains('on'));$('#b-n').textContent=S.basket.size+' selected'}
function drawRes(){$('#st-grid').innerHTML=lastRes.length?lastRes.map(appCard).join(''):'<div class="empty" style="grid-column:1/-1">No results</div>';bar()}
let qt;$('#q').oninput=e=>{clearTimeout(qt);const v=e.target.value.trim();if(!v){$('#st-res').style.display='none';$('#st-cat').style.display='block';return}
 qt=setTimeout(async()=>{$('#st-cat').style.display='none';$('#st-res').style.display='block';$('#st-grid').innerHTML='<div class="empty" style="grid-column:1/-1">Searching repos and AUR…</div>';
  try{lastRes=await api('search?q='+encodeURIComponent(v))}catch(x){lastRes=[]}drawRes()},400)};
$('#b-clear').onclick=()=>{S.basket.clear();drawCats();if($('#st-res').style.display!=='none')drawRes()};
$('#b-go').onclick=async()=>{if(!(await ensureAuth()))return;const names=[...S.basket];runJob('install',{names},'Installing '+names.length+' app'+(names.length>1?'s':''),()=>{S.basket.clear();loadCatalog();if($('#st-res').style.display!=='none'&&$('#q').value)$('#q').oninput({target:$('#q')})})};

try{document.fonts.load("24px 'Material Symbols Rounded'").then(f=>{if(!f.length)document.body.classList.add('noicons')}).catch(()=>document.body.classList.add('noicons'))}catch(e){}
/* ---------- boot ---------- */
(async()=>{await refreshStatus();$('#dest').value=S.status.downloads;await loadScan();loadOverview().catch(e=>toast(e.message))})().catch(e=>toast(e.message));
/* ---------- overview ---------- */
const ago=s=>{const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`};
const tile=(cls,icon,big,label,sub,pct)=>`<div class="tile ${cls}"><span class="ms">${icon}</span><b ${String(big).length>9?'style="font-size:18px;line-height:1.25;margin:4px 0"':''}>${big}</b><span>${label}</span>${sub?`<small>${sub}</small>`:''}${pct!==undefined?`<div class="meter"><i style="width:${Math.min(100,pct)}%"></i></div>`:''}</div>`;
async function loadOverview(){
 const el=$('#ov-tiles');el.innerHTML='<div class="empty" style="grid-column:1/-1">Reading your system…</div>';
 const [o,sv,bd]=await Promise.all([api('overview'),api('services'),api('bundles')]);S.ov=o;
 const mu=o.mem_total-o.mem_avail;
 el.innerHTML=tile('','computer',esc(o.kernel||'?'),esc(o.os),`up ${ago(o.uptime)} · ${o.efi?'UEFI':'BIOS'}${o.desktop?' · '+esc(o.desktop):''}`)
  +tile('t2','memory',fmt(mu),'RAM in use',`of ${fmt(o.mem_total)}`,o.mem_total?mu/o.mem_total*100:0)
  +tile('t3','hard_drive',fmt(o.disk_used),'disk used',`of ${fmt(o.disk_total)}`,o.disk_total?o.disk_used/o.disk_total*100:0)
  +tile('','apps',o.packages,'packages',`${o.explicit} explicit · ${o.aur} AUR`)
  +tile(o.updates?'t3':'t2','system_update_alt',o.updates,'updates waiting',o.yay?'yay ready':'yay not installed')
  +tile('t2','auto_delete',o.orphans,'orphans',`cache ${fmt(o.cache)}`)
  +(o.cpu?tile('','developer_board',esc(o.cpu.replace(/\(R\)|\(TM\)|CPU/g,'').replace(/\s+/g,' ').trim().slice(0,28)),'processor',o.gpu.length?esc(o.gpu[0].replace(/\[|\]/g,'').slice(0,46)):''):'');
 $('#ov-upd').style.display=o.updates?'block':'none';
 $('#ov-upd-list').innerHTML=o.update_list.map(l=>`<span class="fc">${esc(l.split(' ')[0])}</span>`).join('')+(o.updates>o.update_list.length?`<span class="fc">+${o.updates-o.update_list.length} more</span>`:'');
 $('#ov-bundles').innerHTML=bd.map(b=>{const done=b.have===b.pkgs.length;return `<div class="app-card bundle"><div class="ic"><span class="ms">${b.icon}</span></div><div class="tt">${esc(b.title)}</div><p>${esc(b.desc)}</p><div class="f"><span class="sz">${b.have}/${b.pkgs.length} installed</span>${done?'<span class="chip ok"><span class="ms">check</span>Done</span>':`<button class="btn" data-bundle="${b.id}"><span class="ms">download</span>Install</button>`}</div></div>`}).join('');
 drawServices(sv)}
function drawServices(sv){$('#ov-services').innerHTML=sv.map(s=>`<div class="svc ${s.exists?'':'off'}"><label class="sw"><input type="checkbox" data-unit="${esc(s.unit)}" ${s.enabled?'checked':''} ${s.exists?'':'disabled'}><span class="tr"></span><div>${esc(s.title)}<small>${s.exists?esc(s.unit)+' · '+(s.active?'running':'stopped'):esc(s.note)+' (not installed)'}</small></div></label></div>`).join('')}
$('#ov-services').onchange=async e=>{const u=e.target.dataset.unit;if(!u)return;const on=e.target.checked;
 if(!(await ensureAuth())){e.target.checked=!on;return}
 runJob('manage',{kind:'service',unit:u,on},(on?'Enabling ':'Disabling ')+u,async()=>{drawServices(await api('services'))})};
$('#p-overview').onclick=async e=>{
 const b=e.target.closest('[data-bundle]');if(b){if(!(await ensureAuth()))return;runJob('bundle',{id:b.dataset.bundle},'Installing bundle',loadOverview);return}
 const a=e.target.closest('[data-act]')?.dataset.act;if(!a)return;if(!(await ensureAuth()))return;
 const T={update:'Updating everything',orphans:'Removing orphans',cache:'Cleaning cache',mirrors:'Refreshing mirrors'};
 runJob('manage',{kind:a},T[a],()=>{loadOverview();S.inv=null})};

/* ---------- manage ---------- */
const MG={sel:new Set(),filter:'apps',q:'',sort:'name',limit:300};
const MGF=[['apps','Apps'],['explicit','Explicit'],['aur','AUR'],['orph','Orphans'],['big','Biggest'],['all','All']];
async function loadInventory(force){if(S.inv&&!force){drawManage();return}
 $('#mg-list').innerHTML='<div class="empty">Reading every installed package…</div>';
 S.inv=await api('inventory');drawManage()}
function mgVisible(){const q=MG.q.toLowerCase();let L=S.inv.pacman.filter(p=>{
  if(q&&!(p.n.toLowerCase().includes(q)||p.d.toLowerCase().includes(q)))return false;
  switch(MG.filter){case 'apps':return p.gui;case 'explicit':return p.exp;case 'aur':return p.aur;case 'orph':return p.orph;default:return true}});
 L.sort(MG.filter==='big'||MG.sort==='size'?(a,b)=>b.sz-a.sz:(a,b)=>a.n.localeCompare(b.n));return L}
function drawManage(){if(!S.inv)return;
 const inv=S.inv.pacman;$('#mg-tabs').innerHTML='';
 $('#mg-filters').innerHTML=MGF.map(([k,t])=>{const n=inv.filter(p=>k==='apps'?p.gui:k==='explicit'?p.exp:k==='aur'?p.aur:k==='orph'?p.orph:true).length;return `<button class="tab ${k===MG.filter?'on':''}" data-f="${k}">${t}<b>${k==='big'?'':n}</b></button>`}).join('');
 const L=mgVisible(),shown=L.slice(0,MG.limit);
 $('#mg-count').textContent=`${L.length} packages · ${fmt(L.reduce((a,p)=>a+p.sz,0))}`;
 $('#mg-list').innerHTML=shown.length?shown.map(p=>`<label class="row ${p.prot?'locked':''}"><input type="checkbox" data-n="${esc(p.n)}" ${MG.sel.has(p.n)?'checked':''} ${p.prot?'disabled':''}><span class="grow"><b>${esc(p.n)}</b>${p.aur?'<span class="badge aur">AUR</span>':''}${p.orph?'<span class="badge warn">orphan</span>':''}${p.by&&!p.orph?`<span class="badge">needed by ${p.by}</span>`:''}<small>${esc(p.v)} · ${esc(p.d)}</small></span>${p.prot?'<span class="ms lk" title="Protected system package">lock</span>':''}<span class="sz">${fmt(p.sz)}</span></label>`).join('')
  +(L.length>shown.length?`<div class="empty"><button class="btn tonal" id="mg-more">Show ${Math.min(500,L.length-shown.length)} more</button></div>`:''):'<div class="empty">Nothing matches</div>';
 mgBar()}
function mgBar(){const n=MG.sel.size,on=$('#p-manage').classList.contains('on');$('#mg-bar').classList.toggle('show',n>0&&on);
 const sz=S.inv?S.inv.pacman.filter(p=>MG.sel.has(p.n)).reduce((a,p)=>a+p.sz,0):0;$('#mg-n').textContent=`${n} selected · ${fmt(sz)}`}
$('#mg-q').oninput=e=>{MG.q=e.target.value;MG.limit=300;drawManage()};
$('#mg-sort').onchange=e=>{MG.sort=e.target.value;drawManage()};
$('#mg-filters').onclick=e=>{const f=e.target.closest('[data-f]')?.dataset.f;if(f){MG.filter=f;MG.limit=300;drawManage()}};
$('#mg-list').onchange=e=>{const n=e.target.dataset.n;if(n===undefined)return;e.target.checked?MG.sel.add(n):MG.sel.delete(n);mgBar()};
$('#mg-list').onclick=e=>{if(e.target.closest('#mg-more')){MG.limit+=500;drawManage()}};
$('#mg-clear').onclick=()=>{MG.sel.clear();drawManage()};
$('#mg-reload').onclick=()=>loadInventory(true);
$('#mg-rm').onclick=async()=>{if(!MG.sel.size)return;if(!(await ensureAuth()))return;
 const names=[...MG.sel];let plan;try{plan=(await api('removeplan',{names})).plan}catch(e){toast(e.message);return}
 const extra=plan.filter(n=>!MG.sel.has(n));
 const d=$('#rmDlg');$('#rm-body').innerHTML=`<p>This will remove <b>${plan.length}</b> package${plan.length>1?'s':''}${extra.length?`, including <b>${extra.length}</b> unused dependenc${extra.length>1?'ies':'y'}`:''}, plus their config files.</p><div class="chips" style="max-height:200px;overflow:auto">${plan.map(n=>`<span class="fc" ${MG.sel.has(n)?'style="background:var(--prc);color:var(--onprc)"':''}>${esc(n)}</span>`).join('')}</div>`;
 d.showModal();$('#rm-no').onclick=()=>d.close();
 $('#rm-yes').onclick=()=>{d.close();runJob('manage',{kind:'remove',names},'Removing '+names.length+' package'+(names.length>1?'s':''),()=>{MG.sel.clear();S.inv=null;S.ov=null;loadInventory(true)})}};

/* ---------- themes ---------- */
const PRESETS=[['Lavender',265],['Rose',340],['Peach',22],['Sand',48],['Mint',150],['Teal',178],['Sky',208],['Ocean',225],['Grape',295],['Cherry',3]];
const pal=(h,dark,v=1)=>{const t=(h+55)%360,c=(s,l,hh=h)=>`hsl(${hh} ${s}% ${l}%)`;return dark?{bg:c(14,8),sc:c(13,13),on:c(20,90),pr:c(Math.min(100,80*v),80),onpr:c(60,20),prc:c(40,30),onprc:c(90,90),sec:c(25,28),onsec:c(30,90),tc:c(35,28,t)}:{bg:c(40,98),sc:c(30,94),on:c(15,11),pr:c(Math.min(100,48*v),42),onpr:'#fff',prc:c(90,90),onprc:c(70,15),sec:c(40,89),onsec:c(40,15),tc:c(60,88,t)}};
const TH={label:'Lavender',vivid:1};
function drawPrev(){const h=+$('#th-hue').value,d=$('#th-dark').checked,v=TH.vivid,p=pal(h,d,v);
 $('#th-prev').style.background=p.bg;$('#th-prev').innerHTML=`<div class="pw" style="background:${p.sc};color:${p.on}"><b>Material You preview</b><div style="opacity:.75;font-size:13px;margin-top:2px">Window, buttons and chips use this palette</div><span class="pb" style="background:${p.pr};color:${p.onpr}">Primary</span><span class="pb" style="background:${p.sec};color:${p.onsec}">Tonal</span><span class="pb" style="background:${p.tc};color:${p.on}">Tertiary</span></div><div>${['pr','prc','sec','tc','sc','bg'].map(k=>`<span class="dot" style="background:${p[k]}"></span>`).join('')}</div>`;
 $('#th-presets').innerHTML=PRESETS.map(([n,hh])=>`<button class="tab ${Math.abs(hh-h)<3?'on':''}" data-h="${hh}" data-n="${n}">${n}</button>`).join('')}
function themeLive(){THEME.h=+$('#th-hue').value;THEME.dark=$('#th-dark').checked;applyTheme();drawPrev()}
$('#th-hue').oninput=()=>{TH.label='Custom';themeLive()};$('#th-dark').onchange=themeLive;
$('#th-vivid').oninput=e=>{TH.vivid=e.target.value/100;drawPrev()};
$('#th-presets').onclick=e=>{const b=e.target.closest('[data-h]');if(!b)return;$('#th-hue').value=b.dataset.h;TH.label=b.dataset.n;themeLive()};
const opt=(arr,cur,none)=>`<option value="">${none}</option>`+arr.map(x=>`<option ${x===cur?'selected':''}>${esc(x)}</option>`).join('');
async function loadThemes(){const t=await api('themeinfo');S.th=t;$('#th-hue').value=THEME.h;$('#th-dark').checked=THEME.dark;drawPrev();
 $('#th-note').textContent=t.kde?`Plasma detected. Current colour scheme: ${t.current.scheme||'unknown'}.`:'Plasma tools weren\'t found on this machine, so the colour scheme file is saved but not applied. Install Plasma from the Overview bundles first.';
 $('#th-icons').innerHTML=opt(t.icons,t.current.icons,'Icons: leave as is');$('#th-cursor').innerHTML=opt(t.cursors,t.current.cursor,'Cursor: leave as is');$('#th-plasma').innerHTML=opt(t.plasma_themes,t.current.plasma,'Plasma style: leave as is');
 $('#th-revert').disabled=!t.has_prev;
 $('#th-pk').innerHTML=t.packages.map(g=>`<div class="sec-t">${esc(g.cat)}</div><div class="grid">${g.items.map(i=>`<div class="app-card"><div class="tt">${esc(i.title)}</div><code>${esc(i.pkg)}</code><p>${esc(i.desc)}</p><div class="f"><button class="btn tonal" data-tpk="${esc(i.pkg)}"><span class="ms">download</span>Install</button></div></div>`).join('')}</div>`).join('')}
$('#th-pk').onclick=async e=>{const p=e.target.closest('[data-tpk]')?.dataset.tpk;if(!p)return;if(!(await ensureAuth()))return;runJob('install',{names:[p]},'Installing '+p,loadThemes)};
$('#th-apply').onclick=()=>runJob('theme',{hue:+$('#th-hue').value,dark:$('#th-dark').checked,vivid:TH.vivid,label:TH.label,wallpaper:$('#th-wall').checked,gtk:$('#th-gtk').checked,icons:$('#th-icons').value,cursor:$('#th-cursor').value,plasma:$('#th-plasma').value},'Applying theme',loadThemes);
$('#th-revert').onclick=()=>runJob('themerevert',{},'Reverting theme',loadThemes);

/* ---------- keyboard ---------- */
addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select'))return;
 if(e.key==='/'){e.preventDefault();show('store');$('#q').focus()}
 const k={'1':'overview','2':'backup','3':'restore','4':'store','5':'github','6':'manage','7':'themes'}[e.key];if(k)show(k)});



/* ---------- GitHub app browser ---------- */
let GH_ITEMS=[];
async function searchGitHub(){
 const q=$('#gh-q').value.trim();
 if(!q){$('#gh-search-note').textContent='Enter owner/repo or search terms.';$('#gh-results').innerHTML='';return}
 $('#gh-search').disabled=true;$('#gh-search-note').textContent='Searching GitHub…';
 $('#gh-results').innerHTML='<div class="empty">Searching…</div>';
 try{
  GH_ITEMS=await api('ghsearch?q='+encodeURIComponent(q));
  $('#gh-search-note').textContent=GH_ITEMS.length?('Found '+GH_ITEMS.length+' project(s). Check the project and its release before installing.'):'No projects found.';
  $('#gh-results').innerHTML=GH_ITEMS.map(x=>`<div class="app-card gh-card">
   <div class="ic"><span class="ms">code</span></div>
   <div class="tt">${esc(x.repo)}</div>
   <code>${esc(x.lang||'Unknown language')} · ★ ${Number(x.stars||0).toLocaleString()} · updated ${esc(x.updated||'unknown')}</code>
   <p>${esc(x.desc||'No description provided.')}</p>
   <div class="f"><a class="btn outlined" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">View repo</a>
    <button class="btn" data-gh-install="asset" data-repo="${esc(x.repo)}">Install release</button>
    <button class="btn tonal" data-gh-install="clone" data-repo="${esc(x.repo)}">Clone source</button></div>
  </div>`).join('');
 }catch(e){$('#gh-search-note').textContent=e.message;$('#gh-results').innerHTML=''}
 finally{$('#gh-search').disabled=false}
}
$('#gh-search').onclick=()=>searchGitHub();
$('#gh-q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchGitHub()}});
async function loadGhApps(check=true){
 const el=$('#gh-installed');
 el.innerHTML='<div class="empty">Checking installed GitHub apps…</div>';
 try{
  const apps=await api('ghapps?check='+(check?'1':'0'));
  el.innerHTML=apps.length?apps.map(x=>`<div class="app-card gh-card">
   <div class="ic"><span class="ms">${x.mode==='clone'?'folder_git':'deployed_code'}</span></div>
   <div class="tt">${esc(x.repo)}</div>
   <code>${esc(x.mode||'app')} · ${esc(x.tag||'source checkout')}${x.missing?' · missing on disk':''}</code>
   <p>${x.error?'Update check failed: '+esc(x.error):x.update?'A newer version may be available ('+esc(x.latest||'new version')+').':x.missing?'The recorded install path is missing.':'Installed '+esc(x.installed||'')}</p>
   <div class="f"><button class="btn outlined" data-gh-update data-repo="${esc(x.repo)}">Update</button><button class="btn tonal" data-gh-remove data-repo="${esc(x.repo)}">Remove</button></div>
  </div>`).join(''):'<div class="empty">No GitHub apps are registered yet.</div>';
 }catch(e){el.innerHTML='<div class="empty">'+esc(e.message)+'</div>'}
}
$('#gh-refresh').onclick=()=>loadGhApps(true);
$('#gh-results').onclick=async e=>{
 const b=e.target.closest('[data-gh-install]');if(!b)return;
 const repo=b.dataset.repo,mode=b.dataset.ghInstall;
 const label=mode==='clone'?'clone the source repository':'download and install a release asset';
 if(!confirm('This will '+label+' from '+repo+'. Only proceed if you trust this project. Continue?'))return;
 if(!(await ensureAuth()))return;
 runJob('ghinstall',{repo,mode},(mode==='clone'?'Cloning ':'Installing ')+repo,()=>loadGhApps(true));
};
$('#gh-installed').onclick=async e=>{
 const u=e.target.closest('[data-gh-update]'),r=e.target.closest('[data-gh-remove]');
 if(u){const repo=u.dataset.repo;if(!confirm('Update '+repo+' from its GitHub source?'))return;if(!(await ensureAuth()))return;runJob('ghupdate',{repo},'Updating '+repo,()=>loadGhApps(true));}
 if(r){const repo=r.dataset.repo;if(!confirm('Remove the registered GitHub installation for '+repo+'?'))return;if(!(await ensureAuth()))return;runJob('ghremove',{repo},'Removing '+repo,()=>loadGhApps(true));}
};

</script></body></html>
'''


# ------------------------------------------------------------------ main
def open_ui(url):
    for b in ("chromium", "google-chrome-stable", "brave", "vivaldi-stable", "microsoft-edge-stable"):
        p = shutil.which(b)
        if p:
            subprocess.Popen([p, f"--app={url}", "--window-size=1180,820"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    webbrowser.open(url)


def main():
    global PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    setup_sudo_wrapper()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    PORT = srv.server_address[1]
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Arch Migrate running at {url}  (Ctrl+C to quit)")
    if not a.no_browser:
        threading.Timer(0.6, open_ui, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
