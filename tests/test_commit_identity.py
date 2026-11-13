"""Tests for scripts/check-commit-identity.py, the pushed-commit identity allowlist.

Every test builds its commits as raw objects with `git hash-object` in a temporary repository, so no
identity setting, environment variable or `--author` flag is involved, and the remote is simulated by a
remote-tracking ref (`refs/remotes/public/main`) rather than a push.

Run: python3 -I tests/test_commit_identity.py
"""

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts/check-commit-identity.py"
ALLOWED = "124936575+uzaira0@users.noreply.github.com"
WEB_COMMITTER = "noreply@github.com"
OTHER = "someone@example.com"


def clean_env(extra=None):
    """The caller's environment minus git's and pre-commit's per-run variables (a hook sets GIT_DIR)."""
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("GIT_", "PRE_COMMIT_"))
    }
    env.update(extra or {})
    return env


class Repo:
    def __init__(self, path: Path):
        self.path = path
        self.git("init", "-q")
        self.tree = self.git("hash-object", "-t", "tree", "-w", "--stdin", stdin="")
        self.clock = 1_700_000_000

    def git(self, *args, stdin=None):
        return subprocess.run(
            ["git", *args],
            cwd=self.path,
            input=stdin,
            capture_output=True,
            text=True,
            check=True,
            env=clean_env(),
        ).stdout.strip()

    def commit(self, message, author=ALLOWED, committer=WEB_COMMITTER, parents=()):
        self.clock += 60
        lines = [f"tree {self.tree}"]
        lines += [f"parent {parent}" for parent in parents]
        lines.append(f"author Test Author <{author}> {self.clock} +0000")
        lines.append(f"committer Test Committer <{committer}> {self.clock} +0000")
        body = "\n".join(lines) + f"\n\n{message}\n"
        return self.git("hash-object", "-t", "commit", "-w", "--stdin", stdin=body)

    def ref(self, name, sha):
        self.git("update-ref", name, sha)


class CommitIdentityTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Repo(Path(self._tmp.name))
        self.root = self.repo.commit("root")
        self.repo.ref("refs/remotes/public/main", self.root)

    def tearDown(self):
        self._tmp.cleanup()

    def check(self, *args, env=None):
        return subprocess.run(
            [sys.executable, "-I", str(SCRIPT), *args],
            cwd=self.repo.path,
            capture_output=True,
            text=True,
            check=False,
            env=clean_env(env),
        )

    def assertFailsOn(self, result, sha, field):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(f"[fail] {sha} {field} e-mail", result.stdout)

    def test_allowed_identities_pass(self):
        head = self.repo.commit("ok", parents=[self.root])
        bot = self.repo.commit(
            "bot",
            author="49699333+dependabot[bot]@users.noreply.github.com",
            committer=ALLOWED,
            parents=[head],
        )
        result = self.check("--from", self.root, "--to", bot)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("2 commit(s) checked", result.stdout)
        self.assertIn("result: 0 failure(s)", result.stdout)

    def test_other_author_email_fails_naming_commit_and_field(self):
        bad = self.repo.commit("bad author", author=OTHER, parents=[self.root])
        result = self.check("--from", self.root, "--to", bad)
        self.assertFailsOn(result, bad, "author")
        self.assertNotIn("committer e-mail", result.stdout)
        self.assertNotIn(OTHER, result.stdout + result.stderr)

    def test_other_committer_email_fails_naming_commit_and_field(self):
        bad = self.repo.commit("bad committer", committer=OTHER, parents=[self.root])
        result = self.check("--from", self.root, "--to", bad)
        self.assertFailsOn(result, bad, "committer")
        self.assertNotIn("author e-mail", result.stdout)

    def test_whole_history_when_no_from(self):
        bad_root = self.repo.commit("old root", author=OTHER, committer=OTHER)
        child = self.repo.commit("child", parents=[bad_root])
        result = self.check("--to", child)
        self.assertFailsOn(result, bad_root, "author")
        self.assertFailsOn(result, bad_root, "committer")
        self.assertIn("2 commit(s) checked", result.stdout)

    def test_pre_push_existing_branch_checks_only_the_pushed_range(self):
        old = self.repo.commit(
            "already on the remote", author=OTHER, parents=[self.root]
        )
        new = self.repo.commit("pushed now", parents=[old])
        env = {
            "PRE_COMMIT_FROM_REF": old,
            "PRE_COMMIT_TO_REF": new,
            "PRE_COMMIT_REMOTE_NAME": "public",
            "PRE_COMMIT_LOCAL_BRANCH": "refs/heads/feature",
        }
        result = self.check("--pre-push", env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("1 commit(s) checked", result.stdout)

        bad = self.repo.commit("pushed now, bad", committer=OTHER, parents=[new])
        env["PRE_COMMIT_TO_REF"] = bad
        result = self.check("--pre-push", env=env)
        self.assertFailsOn(result, bad, "committer")

    def test_pre_push_new_branch_checks_commits_not_on_the_remote(self):
        # pre-commit gives a new branch whose history reaches the remote's commits
        # from = parent of the first commit not on the remote; this is that range.
        good = self.repo.commit("new branch, first", parents=[self.root])
        bad = self.repo.commit("new branch, second", author=OTHER, parents=[good])
        env = {
            "PRE_COMMIT_FROM_REF": self.root,
            "PRE_COMMIT_TO_REF": bad,
            "PRE_COMMIT_REMOTE_NAME": "public",
            "PRE_COMMIT_LOCAL_BRANCH": "refs/heads/feature",
        }
        result = self.check("--pre-push", env=env)
        self.assertFailsOn(result, bad, "author")
        self.assertIn("2 commit(s) checked", result.stdout)

    def test_pre_push_new_branch_with_unrelated_history_checks_every_commit_not_on_the_remote(
        self,
    ):
        # A branch sharing no commit with the remote (pre-rewrite history) reaches back to a root
        # commit; pre-commit then passes no from/to refs at all, only the branch and the remote name.
        old_root = self.repo.commit("old root", author=OTHER)
        old_tip = self.repo.commit("old tip", parents=[old_root])
        self.repo.ref("refs/heads/old-history", old_tip)
        env = {
            "PRE_COMMIT_REMOTE_NAME": "public",
            "PRE_COMMIT_LOCAL_BRANCH": "refs/heads/old-history",
        }
        result = self.check("--pre-push", env=env)
        self.assertFailsOn(result, old_root, "author")
        self.assertIn("2 commit(s) checked", result.stdout)

        # The same mode does not re-check what the remote already has.
        good = self.repo.commit("on top of the remote", parents=[self.root])
        self.repo.ref("refs/heads/feature", good)
        env["PRE_COMMIT_LOCAL_BRANCH"] = "refs/heads/feature"
        result = self.check("--pre-push", env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("1 commit(s) checked", result.stdout)

    def test_pre_push_without_refs_is_indeterminate(self):
        result = self.check("--pre-push")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_unknown_ref_is_indeterminate(self):
        result = self.check("--from", self.root, "--to", "refs/heads/does-not-exist")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_empty_allowlist_is_indeterminate(self):
        empty = self.repo.path / "empty-allowlist.txt"
        empty.write_text("# nothing listed\n\n")
        head = self.repo.commit("ok", parents=[self.root])
        result = self.check(
            "--allowlist", str(empty), "--from", self.root, "--to", head
        )
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_repository_allowlist_lists_exactly_the_three_identities(self):
        spec = importlib.util.spec_from_file_location("check_commit_identity", SCRIPT)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(
            module.read_allowlist(module.DEFAULT_ALLOWLIST),
            {
                ALLOWED,
                WEB_COMMITTER,
                "49699333+dependabot[bot]@users.noreply.github.com",
            },
        )


if __name__ == "__main__":
    unittest.main()
