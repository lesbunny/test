# Arch Migrate

A single-file Python application for backing up and restoring an Arch/CachyOS home setup and package selections. It includes a package Store, installed-package management, a system overview and service controls, KDE Material You theming, and GitHub release/source installs.

## Run

```bash
python3 arch.py
```

To run without opening a browser automatically:

```bash
python3 arch.py --no-browser --port 8765
```

The app serves its UI on loopback and protects API calls with a random per-run token. Some operations require unlocking sudo in the interface. Review package selections and third-party GitHub releases before installing or removing anything.

## Files

- `arch.py` — assembled app with Python backend and embedded HTML/CSS/JavaScript.
- `test_gh.py` — GitHub integration regression tests with an isolated temporary home and fake package manager.
- `recovery-report.json` — original conversation recovery report kept for provenance.

## Tests

```bash
python3 -m py_compile arch.py test_gh.py
python3 test_gh.py
```

The UI uses optional remote Google Fonts and Material Symbols. The core app uses Python's standard library.
