import atexit, base64, hashlib, importlib.util, io, json, os, shutil, sys, tarfile, tempfile, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Isolated test home and fake pacman: regression tests never modify the host system.
_TEST_ROOT = Path(tempfile.mkdtemp(prefix="arch-gh-test-"))
HOME = _TEST_ROOT / "home"
HOME.mkdir(parents=True, exist_ok=True)
_STUBBIN = _TEST_ROOT / "bin"
_STUBBIN.mkdir(parents=True, exist_ok=True)
_PACMAN = _STUBBIN / "pacman"
_PACMAN.write_text("#!/bin/sh\n# Test stub that imitates the bits of pacman the app reads.\nargs=\"$*\"\ncase \"$1\" in\n  -Qq) if [ -n \"$2\" ]; then case \"$2\" in fuse2|bash|vlc|linux|sudo|firefox|libfoo|yay|ttf-roboto) echo \"$2\";; *) exit 1;; esac; else printf 'bash\\nfuse2\\nvlc\\nlinux\\nsudo\\nfirefox\\nlibfoo\\nyay\\nttf-roboto\\n'; fi;;\n  -Qqe) printf 'bash\\nvlc\\nlinux\\nsudo\\nfirefox\\nyay\\n';;\n  -Qqen) printf 'bash\\nvlc\\nlinux\\nsudo\\nfirefox\\n';;\n  -Qqem) printf 'yay\\n';;\n  -Qdtq) printf 'libfoo\\n';;\n  -Slq) printf 'pipewire\\nwireplumber\\nalsa-utils\\npipewire-pulse\\nvlc\\nfirefox\\nttf-roboto\\nttf-dejavu\\nnoto-fonts\\nnoto-fonts-emoji\\nnoto-fonts-cjk\\nttf-liberation\\nbash\\n';;\n  -Qp) echo \"pkgrepo 1.0-1\";;\n  -Qi)\n    if [ -n \"$2\" ]; then for n in \"$@\"; do [ \"$n\" = \"-Qi\" ] && continue; printf 'Name            : %s\\nVersion         : 9.9-1\\nDescription     : Installed %s\\nInstalled Size  : 2.00 MiB\\nInstall Reason  : Explicitly installed\\nRequired By     : None\\n\\n' \"$n\" \"$n\"; done\n    else\n      printf 'Name            : firefox\\nVersion         : 130.0-1\\nDescription     : Fast, Private & Safe Web Browser\\nInstalled Size  : 262.50 MiB\\nInstall Reason  : Explicitly installed\\nRequired By     : None\\n\\n'\n      printf 'Name            : vlc\\nVersion         : 3.0.21-1\\nDescription     : Multi-platform MPEG, VCD/DVD, and DivX player\\nInstalled Size  : 40.10 MiB\\nInstall Reason  : Explicitly installed\\nRequired By     : None\\n\\n'\n      printf 'Name            : libfoo\\nVersion         : 1.0-1\\nDescription     : A leftover library\\nInstalled Size  : 1.50 MiB\\nInstall Reason  : Installed as a dependency for another package\\nRequired By     : None\\n\\n'\n      printf 'Name            : linux\\nVersion         : 6.17-1\\nDescription     : The Linux kernel\\nInstalled Size  : 140.00 MiB\\nInstall Reason  : Explicitly installed\\nRequired By     : None\\n\\n'\n      printf 'Name            : yay\\nVersion         : 12.5-1\\nDescription     : Yet another yogurt\\nInstalled Size  : 9.00 MiB\\nInstall Reason  : Explicitly installed\\nRequired By     : None\\n\\n'\n    fi;;\n  -Ql) printf 'firefox /usr/share/applications/firefox.desktop\\nvlc /usr/share/applications/vlc.desktop\\nyay /usr/bin/yay\\n';;\n  -Si) shift; for n in \"$@\"; do printf 'Repository      : extra\\nName            : %s\\nVersion         : 1.0-1\\nDescription     : Official description of %s\\nURL             : https://example.org\\nLicenses        : GPL-3.0-or-later\\nDownload Size   : 1.00 MiB\\nInstalled Size  : 3.00 MiB\\nPackager        : Arch Dev\\nDepends On      : glibc  libfoo\\n\\n' \"$n\" \"$n\"; done;;\n  -Ss) printf 'extra/vlc 3.0.21-1\\n    Multi-platform media player\\n';;\n  -Qu) printf 'firefox 130.0-1 -> 131.0-1\\n';;\n  *) exit 0;;\nesac")
_PACMAN.chmod(0o755)
os.environ["HOME"] = str(HOME)
os.environ["PATH"] = str(_STUBBIN) + os.pathsep + os.environ.get("PATH", "")
atexit.register(lambda: shutil.rmtree(_TEST_ROOT, ignore_errors=True))
spec = importlib.util.spec_from_file_location("am", str(Path(__file__).with_name("arch.py")))
am = importlib.util.module_from_spec(spec)
spec.loader.exec_module(am)

# ---------- fake release files
def sha(b): return hashlib.sha256(b).hexdigest()
APPIMG1 = b"\x7fELF" + b"appimage-v1" * 50
APPIMG2 = b"\x7fELF" + b"appimage-v2" * 60
def make_tgz():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for name, data, mode in (("archtool-1.0/bin/archtool", b"\x7fELF" + b"x" * 400, 0o755),
                                 ("archtool-1.0/bin/helper", b"\x7fELF" + b"y" * 100, 0o755),
                                 ("archtool-1.0/README.md", b"hi", 0o644)):
            ti = tarfile.TarInfo(name); ti.size = len(data); ti.mode = mode
            t.addfile(ti, io.BytesIO(data))
    return buf.getvalue()
TGZ = make_tgz()
PKG = b"fake-pkg-bytes" * 20
PKGBUILD = "pkgname=withpb\npkgver=1\nbuild(){ echo hi; }\n"
STATE = {"appimg_tag": "v1.0.0"}

def release(repo):
    if repo == "acme/appimg":
        v = STATE["appimg_tag"][1:]; data = APPIMG1 if v == "1.0.0" else APPIMG2
        return {"tag_name": "v" + v, "name": "v" + v, "published_at": "2026-10-01T00:00:00Z", "body": "notes", "assets": [
            {"name": f"appimg-{v}-x86_64.AppImage", "size": len(data), "digest": "sha256:" + sha(data), "browser_download_url": f"{BASE}/dl/appimg-{v}-x86_64.AppImage"},
            {"name": f"appimg-{v}-aarch64.AppImage", "size": 5, "browser_download_url": f"{BASE}/dl/x"},
            {"name": f"appimg_{v}_amd64.deb", "size": 5, "browser_download_url": f"{BASE}/dl/x"},
            {"name": f"appimg-{v}-x86_64.AppImage.zsync", "size": 5, "browser_download_url": f"{BASE}/dl/x"},
            {"name": f"appimg-{v}-windows-x64.zip", "size": 5, "browser_download_url": f"{BASE}/dl/x"},
            {"name": "SHA256SUMS.txt", "size": 5, "browser_download_url": f"{BASE}/dl/x"}]}
    if repo == "acme/archtool":
        return {"tag_name": "v1.0", "published_at": "2026-09-01T00:00:00Z", "assets": [
            {"name": "archtool-linux-x86_64.tar.gz", "size": len(TGZ), "digest": "sha256:" + sha(TGZ), "browser_download_url": f"{BASE}/dl/archtool.tgz"},
            {"name": "archtool-macos-arm64.tar.gz", "size": 5, "browser_download_url": f"{BASE}/dl/x"}]}
    if repo == "acme/baddigest":
        return {"tag_name": "v1", "assets": [{"name": "bad-x86_64.AppImage", "size": 10, "digest": "sha256:" + "0" * 64, "browser_download_url": f"{BASE}/dl/bad.AppImage"}]}
    if repo == "acme/pkgrepo":
        return {"tag_name": "1.0", "assets": [{"name": "pkgrepo-1.0-1-x86_64.pkg.tar.zst", "size": len(PKG), "digest": "sha256:" + sha(PKG), "browser_download_url": f"{BASE}/dl/pkgrepo.pkg.tar.zst"}]}
    if repo == "acme/nonrelease":
        return {"tag_name": "v1", "assets": [{"name": "app-win.exe", "browser_download_url": f"{BASE}/dl/x"}]}
    return None

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _j(self, o, code=200):
        b = json.dumps(o).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); p = u.path
        if p == "/search/repositories":
            return self._j({"items": [{"full_name": "acme/appimg", "description": "An app", "stargazers_count": 1234, "language": "Rust", "license": {"spdx_id": "MIT"}, "pushed_at": "2026-10-20T10:00:00Z", "archived": False, "html_url": "https://github.com/acme/appimg", "default_branch": "main"}]})
        if p.startswith("/dl/"):
            data = {"/dl/appimg-1.0.0-x86_64.AppImage": APPIMG1, "/dl/appimg-1.1.0-x86_64.AppImage": APPIMG2, "/dl/archtool.tgz": TGZ, "/dl/pkgrepo.pkg.tar.zst": PKG, "/dl/bad.AppImage": b"\x7fELFbad"}.get(p, b"x")
            self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); return self.wfile.write(data)
        parts = p.strip("/").split("/")
        if parts[0] == "repos" and len(parts) >= 3:
            repo = parts[1] + "/" + parts[2]; rest = "/".join(parts[3:])
            if repo not in ("acme/appimg", "acme/archtool", "acme/baddigest", "acme/pkgrepo", "acme/nonrelease", "acme/withpb"):
                return self._j({"message": "Not Found"}, 404)
            if rest == "":
                return self._j({"full_name": repo, "description": "desc " + repo, "stargazers_count": 7, "language": "C", "license": None, "pushed_at": "2026-10-01T00:00:00Z", "archived": repo == "acme/nonrelease", "html_url": "https://github.com/" + repo, "default_branch": "main"})
            if rest == "releases/latest":
                r = release(repo)
                return self._j(r, 200) if r else self._j({"message": "Not Found"}, 404)
            if rest == "contents/PKGBUILD":
                return self._j({"content": base64.b64encode(PKGBUILD.encode()).decode()}) if repo == "acme/withpb" else self._j({"message": "Not Found"}, 404)
            if rest == "commits":
                return self._j([{"sha": "abcdef1234567"}])
        self._j({"message": "Not Found"}, 404)

srv = HTTPServer(("127.0.0.1", 0), H); BASE = f"http://127.0.0.1:{srv.server_address[1]}"
threading.Thread(target=srv.serve_forever, daemon=True).start()
am.GH_API = BASE
am.gh_url_ok = lambda u: u.startswith("http://127.0.0.1")   # test-only: real one allows github hosts only

# real gh_url_ok behaviour (re-import to test the production function)
spec2 = importlib.util.spec_from_file_location("am2", "/tmp/work/arch-migrate.py"); am2 = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(am2)
for u, ok in (("https://github.com/a/b/releases/download/v1/x", True), ("https://objects.githubusercontent.com/x", True),
              ("https://release-assets.githubusercontent.com/x", True), ("http://github.com/x", False),
              ("https://evilgithub.com/x", False), ("https://github.com.evil.io/x", False), ("https://evil.io/github.com", False)):
    assert am2.gh_url_ok(u) == ok, u
print("gh_url_ok production host rules OK")

# parse_gh / classify
for s, want in (("https://github.com/acme/appimg", "acme/appimg"), ("github.com/acme/appimg.git", "acme/appimg"), ("https://github.com/acme/appimg/releases/tag/v1", "acme/appimg"),
                ("acme/appimg", "acme/appimg"), ("firefox", None), ("/etc/passwd", None), ("https://example.com/a/b", None)):
    assert am.parse_gh(s) == want, (s, am.parse_gh(s))
cl = {"app-1.0-x86_64.AppImage": "appimage", "app-1.0-aarch64.AppImage": None, "app_amd64.deb": None, "app-linux-x86_64.tar.gz": "archive",
      "app-darwin-amd64.tar.gz": None, "app-windows-x64.zip": None, "pkg-1-1-x86_64.pkg.tar.zst": "pacman", "SHA256SUMS.txt": None,
      "tool-i686.tar.gz": None, "machine-linux.tar.gz": "archive", "app-linux-x86.zip": None, "app.AppImage.zsync": None, "app-x86-64.AppImage": "appimage"}
for n, k in cl.items():
    assert am.classify_asset(n) == k, (n, am.classify_asset(n), k)
print("parse_gh + classify_asset OK")

# search / info / pkgbuild
r = am.gh_search("appimg"); assert r[0]["repo"] == "acme/appimg" and r[0]["stars"] == 1234 and r[0]["license"] == "MIT"
r = am.gh_search("https://github.com/acme/archtool"); assert r[0]["repo"] == "acme/archtool"
i = am.gh_info("acme/appimg"); assert i["release"]["tag"] == "v1.0.0" and [a["kind"] for a in i["release"]["assets"]] == ["appimage"], i["release"]["assets"]
i = am.gh_info("acme/withpb"); assert i["pkgbuild"] and i["release"] is None
pb = am.gh_pkgbuild("acme/withpb"); assert pb["text"] == PKGBUILD and pb["sha"] == sha(PKGBUILD.encode())
try: am.gh_info("acme/ghost"); raise SystemExit("expected 404")
except RuntimeError as e: assert "Not found" in str(e)
print("search/info/pkgbuild OK")

# dry-run runner
CMDS = []
def fake_run(job, cmd, cwd=None, stdin_text=None):
    CMDS.append(cmd); job.log("$ " + " ".join(cmd))
    if cmd[:2] == ["git", "clone"]:
        dst = Path(cmd[-1]); dst.mkdir(parents=True); (dst / ".git").mkdir()
        if "withpb" in cmd[-2]: (dst / "PKGBUILD").write_text(PKGBUILD)
    if cmd[0] == "makepkg": (Path(cwd) / "withpb-1-1-x86_64.pkg.tar.zst").write_bytes(b"x")
    return 0
am.run = fake_run

def run_job(fn, *a):
    j = am.Job("t"); fn(j, *a); return j

# --- AppImage install
j = run_job(am.job_gh_install, {"repo": "acme/appimg", "mode": "asset", "asset": "appimg-1.0.0-x86_64.AppImage"})
p = HOME / "Applications/appimg-1.0.0-x86_64.AppImage"; d = HOME / ".local/share/applications/archmig-appimg.desktop"
assert p.read_bytes() == APPIMG1 and os.access(p, os.X_OK) and d.exists()
assert 'Exec="%s" %%U' % p in d.read_text(), d.read_text()
assert any("SHA-256 matches" in l for l in j.lines)
reg = am.reg_load(); assert reg[0]["tag"] == "v1.0.0" and reg[0]["kind"] == "appimage"
print("AppImage install OK; fuse2 check ran:", any(c[:4] == ["sudo", "pacman", "-S", "--needed"] and "fuse2" in c for c in CMDS) or "fuse2 already present (stub)")

# --- update check + update
st = am.gh_apps_state(True); assert st[0]["update"] is False
STATE["appimg_tag"] = "v1.1.0"
st = am.gh_apps_state(True); assert st[0]["update"] is True and st[0]["latest"] == "v1.1.0"
j = run_job(am.job_manage, {"kind": "ghupdate", "repo": "acme/appimg"})
assert (HOME / "Applications/appimg-1.1.0-x86_64.AppImage").read_bytes() == APPIMG2
assert not p.exists(), "old version should be cleaned up"
assert am.reg_load()[0]["tag"] == "v1.1.0" and len(am.reg_load()) == 1
print("update flow OK (matched asset by fingerprint, old file removed)")

# --- archive install
j = run_job(am.job_gh_install, {"repo": "acme/archtool", "mode": "asset", "asset": "archtool-linux-x86_64.tar.gz"})
b = HOME / ".local/bin/archtool"
assert b.is_symlink() and b.resolve() == (HOME / ".local/opt/archtool/bin/archtool").resolve() and os.access(b, os.X_OK)
assert not (HOME / ".local/opt/archtool/archtool-1.0").exists()
print("archive install OK ->", os.readlink(b))

# --- digest mismatch
try: run_job(am.job_gh_install, {"repo": "acme/baddigest", "mode": "asset", "asset": "bad-x86_64.AppImage"}); raise SystemExit("digest mismatch not caught")
except RuntimeError as e: assert "doesn't match" in str(e); print("digest mismatch rejected OK")
assert not (HOME / "Applications/bad-x86_64.AppImage").exists()

# --- pacman package asset
CMDS.clear(); j = run_job(am.job_gh_install, {"repo": "acme/pkgrepo", "mode": "asset", "asset": "pkgrepo-1.0-1-x86_64.pkg.tar.zst"})
assert any(c[:3] == ["sudo", "pacman", "-U"] for c in CMDS); e = [x for x in am.reg_load() if x["repo"] == "acme/pkgrepo"][0]; assert e["pkg"] == "pkgrepo", e
print("pacman -U asset OK, pkg name:", e["pkg"])

# --- no usable release
try: run_job(am.job_gh_install, {"repo": "acme/nonrelease", "mode": "asset", "asset": "app-win.exe"}); raise SystemExit("should fail")
except RuntimeError as e: print("no-usable-asset message OK:", str(e)[:60])

# --- PKGBUILD build (sha must match, and a changed PKGBUILD must be refused)
j = run_job(am.job_gh_install, {"repo": "acme/withpb", "mode": "pkgbuild", "sha": pb["sha"]})
assert any(c[0] == "makepkg" for c in CMDS) and [x for x in am.reg_load() if x["repo"] == "acme/withpb"][0]["mode"] == "pkgbuild"
CMDS.clear()
try: run_job(am.job_gh_install, {"repo": "acme/withpb", "mode": "pkgbuild", "sha": "deadbeef"}); raise SystemExit("sha mismatch not caught")
except RuntimeError as e: assert "changed since you reviewed" in str(e); assert not any(c[0] == "makepkg" for c in CMDS); print("PKGBUILD review pinning OK (no build on mismatch)")

# --- clone
j = run_job(am.job_gh_install, {"repo": "acme/archtool", "mode": "clone"}); assert (HOME / "Projects/github/archtool/.git").exists()
# clone replaced registry entry for archtool (same repo key) -> restore archtool entry for the next tests
am.reg_put({"repo": "acme/archtool", "mode": "asset", "kind": "archive", "fp": am.fingerprint("archtool-linux-x86_64.tar.gz"), "asset": "archtool-linux-x86_64.tar.gz", "tag": "v1.0", "dir": str(HOME / ".local/opt/archtool"), "bin": str(b)})

# --- manifest + restore round trip on a fresh home
manifest_gh = [{k: e.get(k) for k in ("repo", "mode", "kind", "fp", "asset")} for e in am.reg_load()]
print("manifest github entries:", [(e["repo"], e["mode"]) for e in manifest_gh])
import shutil
for q in ("Applications", ".local", ".config"):
    shutil.rmtree(HOME / q, ignore_errors=True)
assert am.gh_apps_state(False) == []
# restore only the github step by hand-calling job_restore with an archive containing nothing
arc = HOME / "empty.tar"
with tarfile.open(arc, "w") as t:
    pass
CMDS.clear()
j = am.Job("r")
try:
    am.job_restore(j, {"archive": str(arc), "steps": {"github": True}, "packages": {}, "github": manifest_gh})
except Exception as e:
    print("restore raised", e)
print("\n".join(l for l in j.lines if l.startswith(("--", "!", "All", "Finished", "  "))))
regs = {e["repo"]: e for e in am.reg_load()}
print("restored:", sorted(regs))
assert "acme/appimg" in regs and regs["acme/appimg"]["tag"] == "v1.1.0" and (HOME / "Applications/appimg-1.1.0-x86_64.AppImage").exists()
assert "acme/archtool" in regs and (HOME / ".local/bin/archtool").is_symlink()
assert j.result["failed"] and all("withpb" in f or "GitHub" in f for f in j.result["failed"]), j.result
print("restore: asset apps re-downloaded; PKGBUILD app flagged for manual review:", j.result["failed"])

# --- remove
CMDS.clear()
run_job(am.job_manage, {"kind": "ghremove", "repo": "acme/appimg"})
assert not list((HOME / "Applications").glob("*")) and not (HOME / ".local/share/applications/archmig-appimg.desktop").exists()
run_job(am.job_manage, {"kind": "ghremove", "repo": "acme/archtool"})
assert not (HOME / ".local/opt/archtool").exists() and not (HOME / ".local/bin/archtool").is_symlink()
print("remove OK; remaining registry:", [e["repo"] for e in am.reg_load()])
# safety: a tampered registry must not delete outside our folders
victim = HOME / "victim.txt"; victim.write_text("keep me")
am.reg_save([{"repo": "evil/app", "mode": "asset", "kind": "appimage", "path": str(victim), "desktop": str(victim), "dir": str(HOME), "bin": str(victim)}])
run_job(am.job_manage, {"kind": "ghremove", "repo": "evil/app"})
assert victim.read_text() == "keep me" and HOME.exists()
print("tampered registry cannot delete outside ~/Applications, ~/.local/opt, app menu: OK")
print("\nALL GITHUB TESTS PASSED")
