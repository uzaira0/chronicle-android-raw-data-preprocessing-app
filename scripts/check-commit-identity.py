#!/usr/bin/env python3
"""Refuse commits whose author or committer e-mail is not in commit-identities.txt.

The history of this repository was rewritten on 2026-11-12 so that every commit carries an allowed
identity. This check keeps old commits from coming back: a commit passes only if both its author and
its committer e-mail appear, exactly, in the allowlist file (commit-identities.txt at the repository
root). It reads the raw commit objects (`git cat-file --batch`), so .mailmap and log settings play no
part.

Which commits are checked:
  --from A --to B   the commits reachable from B and not from A (`git rev-list B ^A`)
  --to B            every commit reachable from B
  --pre-push        the commits a pre-commit pre-push hook is pushing, from the variables pre-commit
                    sets: PRE_COMMIT_FROM_REF..PRE_COMMIT_TO_REF when it gives a range (an existing
                    remote branch, or a new branch whose history reaches the remote's commits); when it
                    gives no range (a new branch sharing no commit with the remote), every commit of
                    PRE_COMMIT_LOCAL_BRANCH that no PRE_COMMIT_REMOTE_NAME remote-tracking ref reaches.

Output names each failing commit and field, not the e-mail, so a CI log does not republish an old
address. `git show -s --format='%ae %ce' <commit>` shows it locally.

Exit codes: 0 every checked commit passes, 1 at least one does not, 2 indeterminate (missing or
empty allowlist, unknown ref, missing pre-push variables, a git failure). Never a pass on 2.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_ALLOWLIST = Path(__file__).resolve().parents[1] / "commit-identities.txt"
ZERO_SHA = "0" * 40
IDENTITY_LINE = re.compile(rb"^(author|committer) .*<([^<>]*)> -?\d+ [+-]\d{4}$")


class Indeterminate(Exception):
    pass


def read_allowlist(path: Path) -> set[str]:
    """One e-mail per line; `#` starts a comment; blank lines are ignored."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise Indeterminate(f"cannot read allowlist {path}: {error}") from error
    entries = set()
    for number, line in enumerate(text.splitlines(), 1):
        entry = line.split("#", 1)[0].strip()
        if not entry:
            continue
        if "@" not in entry or any(c.isspace() for c in entry):
            raise Indeterminate(f"{path}:{number}: not a single e-mail address")
        entries.add(entry)
    if not entries:
        raise Indeterminate(f"allowlist {path} lists no identity")
    return entries


def git(*args: str, stdin: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["git", *args], input=stdin, capture_output=True, check=False
    )
    if result.returncode != 0:
        message = result.stderr.decode(errors="replace").strip()
        raise Indeterminate(f"git {' '.join(args)}: {message}")
    return result.stdout


def resolve(ref: str) -> str:
    return (
        git("rev-parse", "--verify", "--quiet", "--end-of-options", f"{ref}^{{commit}}")
        .decode()
        .strip()
    )


def commits_in(to_ref: str, exclude: list[str]) -> list[str]:
    output = git("rev-list", resolve(to_ref), *exclude, "--")
    return output.decode().split()


def pre_push_selection(env: dict[str, str]) -> tuple[str, list[str], str]:
    from_ref = env.get("PRE_COMMIT_FROM_REF", "")
    to_ref = env.get("PRE_COMMIT_TO_REF", "")
    remote = env.get("PRE_COMMIT_REMOTE_NAME", "")
    local = env.get("PRE_COMMIT_LOCAL_BRANCH", "")
    if from_ref and to_ref and from_ref != ZERO_SHA:
        return to_ref, [f"^{resolve(from_ref)}"], f"{from_ref[:12]}..{to_ref[:12]}"
    if local and remote:
        target = to_ref or local
        return (
            target,
            ["--not", f"--remotes={remote}"],
            f"{target} not on remote {remote}",
        )
    raise Indeterminate(
        "--pre-push needs PRE_COMMIT_FROM_REF/PRE_COMMIT_TO_REF or "
        "PRE_COMMIT_LOCAL_BRANCH/PRE_COMMIT_REMOTE_NAME (run it from pre-commit's pre-push stage)"
    )


def identities(shas: list[str]) -> dict[str, dict[str, str | None]]:
    """Map each commit to its raw author and committer e-mail (None when the header is unparsable)."""
    if not shas:
        return {}
    output = git("cat-file", "--batch", stdin=("\n".join(shas) + "\n").encode())
    found: dict[str, dict[str, str | None]] = {}
    position = 0
    for sha in shas:
        header_end = output.index(b"\n", position)
        name, kind, size = output[position:header_end].split()
        if kind != b"commit":
            raise Indeterminate(f"{name.decode()} is a {kind.decode()}, not a commit")
        body = output[header_end + 1 : header_end + 1 + int(size)]
        position = header_end + 1 + int(size) + 1
        fields: dict[str, str | None] = {"author": None, "committer": None}
        for line in body.split(b"\n\n", 1)[0].split(b"\n"):
            match = IDENTITY_LINE.match(line)
            if match:
                fields[match.group(1).decode()] = match.group(2).decode(
                    errors="replace"
                )
        found[sha] = fields
    return found


def main(argv: list[str], env: dict[str, str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--from", dest="from_ref", help="exclude commits reachable from this ref"
    )
    parser.add_argument(
        "--to", dest="to_ref", help="check commits reachable from this ref"
    )
    parser.add_argument(
        "--pre-push",
        action="store_true",
        help="take the range from pre-commit's pre-push variables",
    )
    parser.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST)
    args = parser.parse_args(argv)
    try:
        allowed = read_allowlist(args.allowlist)
        if args.pre_push:
            to_ref, exclude, label = pre_push_selection(env)
        elif args.to_ref:
            to_ref = args.to_ref
            exclude = [f"^{resolve(args.from_ref)}"] if args.from_ref else []
            label = (
                f"{args.from_ref}..{args.to_ref}"
                if args.from_ref
                else f"all of {args.to_ref}"
            )
        else:
            raise Indeterminate("give --to (with optional --from) or --pre-push")
        shas = commits_in(to_ref, exclude)
        found = identities(shas)
    except Indeterminate as error:
        print(f"commit-identity: indeterminate: {error}", file=sys.stderr)
        return 2
    failures = 0
    print(
        f"commit-identity: {len(shas)} commit(s) checked ({label}) against {args.allowlist.name}"
    )
    for sha in shas:
        for field in ("author", "committer"):
            email = found[sha][field]
            if email is None:
                print(
                    f"[fail] {sha} {field} e-mail could not be read from the commit header"
                )
                failures += 1
            elif email not in allowed:
                print(f"[fail] {sha} {field} e-mail is not in {args.allowlist.name}")
                failures += 1
    print(f"result: {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:], dict(os.environ)))
