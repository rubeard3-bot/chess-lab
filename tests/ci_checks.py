"""Whole-repo checks for CI (and anyone who wants to run them locally).

Reuses the exact check logic from the Stop hook (.claude/hooks/verify_stop.py)
but runs it over EVERY file instead of only changed ones:
  CHECK 1  JavaScript syntax (node --check), vendored libraries skipped
  CHECK 2  every element using the "hidden" class has a CSS rule that hides it
Exits 1 if anything fails.  Usage: python3 tests/ci_checks.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "verify_stop", os.path.join(ROOT, ".claude", "hooks", "verify_stop.py"))
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)

files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    rel_dir = os.path.relpath(dirpath, ROOT)
    parts = rel_dir.replace("\\", "/").split("/")
    if parts[0] in (".git", "legacy", "node_modules") or "node_modules" in parts or "Already Analyzed" in parts:
        dirnames[:] = []
        continue
    for name in filenames:
        if name.endswith((".js", ".html")):
            rel = os.path.normpath(os.path.join(rel_dir, name)).replace("\\", "/")
            files.append(rel)

findings = []
vs.check_js_syntax(ROOT, files, findings)
vs.check_hidden_css(ROOT, files, findings)

print(f"Checked {len(files)} files")
if findings:
    for i, f in enumerate(findings, 1):
        print(f"  FAIL {i}. {f}")
    sys.exit(1)
print("  PASS  JavaScript syntax and hidden-class CSS rules")
