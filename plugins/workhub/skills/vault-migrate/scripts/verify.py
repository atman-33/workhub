"""Verify a copy-only Obsidian vault migration.

Checks, given a source vault, a destination vault, and the mapping used to
copy between them:

1. missing   - mapped source files with no file at the destination path
2. mismatch  - destination file exists but differs in size (cp -n collision)
3. link delta - wikilink targets broken in the destination that were not
                already broken in the source

Exit code 0 iff all three counters are zero.

Usage:
    python verify.py --mapping mapping.json SOURCE_VAULT DEST_VAULT

mapping.json is a list of {"src": <dir relative to source vault>,
"dst": <dir relative to dest vault>} entries, in the order they were copied.
"""

import argparse
import json
import os
import re
import sys

EXCLUDED_DIRS = {".obsidian", ".claude", ".opencode", ".git", "node_modules"}
WIKILINK = re.compile(r"\[\[([^\]|#^]+?)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]")


def walk(root):
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
        for f in files:
            yield os.path.join(dirpath, f)


def link_names(root):
    """All basenames a wikilink can resolve to in this vault."""
    names = set()
    for path in walk(root):
        f = os.path.basename(path)
        names.add(f.lower())
        if f.endswith((".md", ".canvas")):
            names.add(os.path.splitext(f)[0].lower())
    return names


def broken_targets(root):
    names = link_names(root)
    broken = {}
    for path in walk(root):
        if not path.endswith(".md"):
            continue
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for m in WIKILINK.finditer(text):
            target = m.group(1).strip()
            base = target.split("/")[-1].lower()
            if base and base not in names and base + ".md" not in names:
                broken.setdefault(target, []).append(os.path.relpath(path, root))
    return broken


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mapping", required=True, help="JSON list of {src, dst} dirs")
    ap.add_argument("source", help="source vault root")
    ap.add_argument("dest", help="destination vault root")
    args = ap.parse_args()

    with open(args.mapping, encoding="utf-8") as f:
        mapping = json.load(f)

    missing, mismatch = [], []
    for pair in mapping:
        src_dir = os.path.join(args.source, pair["src"])
        dst_dir = os.path.join(args.dest, pair["dst"])
        if os.path.isfile(src_dir):
            pairs = [(src_dir, dst_dir)]
        else:
            pairs = []
            for s in walk(src_dir):
                rel = os.path.relpath(s, src_dir)
                pairs.append((s, os.path.join(dst_dir, rel)))
        for s, d in pairs:
            if not os.path.exists(d):
                missing.append(d)
            elif os.path.getsize(s) != os.path.getsize(d):
                mismatch.append((s, d))

    src_broken = set(broken_targets(args.source))
    dst_broken = broken_targets(args.dest)
    delta = {t: v for t, v in dst_broken.items() if t not in src_broken}

    print(f"missing: {len(missing)}")
    for m in missing[:20]:
        print(f"  {m}")
    print(f"mismatch (collision, source not copied): {len(mismatch)}")
    for s, d in mismatch[:20]:
        print(f"  {s} -> {d}")
    print(f"link delta (broken in dest, not in source): {len(delta)}")
    for t, srcs in sorted(delta.items())[:20]:
        print(f"  [[{t}]]  <- {srcs[0]}")
    print(f"pre-existing broken links carried over: {len(src_broken & set(dst_broken))}")

    ok = not (missing or mismatch or delta)
    print("RESULT:", "OK (delta-zero)" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
