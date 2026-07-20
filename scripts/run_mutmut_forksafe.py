"""mutmut wrapper that runs each MUTANT's tests in a fresh subprocess.

Why this exists: mutmut 3 runs the baseline suite in-process (warming polars'
rayon thread pool), then `os.fork()`s a child per mutant and calls
`pytest.main` inside the fork. The rayon pool threads do not survive the fork,
so the first polars operation in the child deadlocks until mutmut's wall-clock
reaper sends SIGXCPU — every polars-covered mutant is misfiled as "timeout"
(observed: 3,727/5,038, with a survived mutant reproducibly reported ⏰; the
bare-fork repro even triggers CPython's "use of fork() may lead to deadlocks
in the child" DeprecationWarning). POLARS_MAX_THREADS=1 does not help.

Fix: monkeypatch PytestRunner.run_tests so mutant runs (mutant_name != None)
exec a fresh `python -m pytest` — fork+exec rebuilds the process image, polars
creates a live pool, and the pytest exit code flows back unchanged (0 =
survived, 1 = killed). Stats/baseline/forced-fail runs stay in-process because
mutmut's per-function coverage attribution and duration recording only work
there. The parent's SIGXCPU reaper still bounds real infinite-loop mutants.

Usage (same CLI as mutmut itself):
    .venv/bin/python scripts/run_mutmut_forksafe.py run
    .venv/bin/python scripts/run_mutmut_forksafe.py results
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Iterable

import mutmut.__main__ as mutmut_main


def _forksafe_run_tests(
    self: mutmut_main.PytestRunner, *, mutant_name: str | None, tests: Iterable[str]
) -> int:
    if mutant_name is None:
        return _original_run_tests(self, mutant_name=mutant_name, tests=tests)

    pytest_args = self._pytest_args_regular_run(tests)
    argv = [
        sys.executable,
        "-m",
        "pytest",
        "--rootdir=.",
        "--tb=native",
        *pytest_args,
        *self._pytest_add_cli_args,
    ]
    # MUTANT_UNDER_TEST is already in os.environ (set by the forked child);
    # the subprocess inherits it and the sandbox trampolines dispatch on it.
    result = subprocess.run(argv, cwd="mutants", capture_output=True)
    if result.returncode == 4:
        raise mutmut_main.BadTestExecutionCommandsException(argv)
    # A signal-killed pytest (segfault under the mutant) is a kill, not noise.
    if result.returncode < 0:
        return 1
    return result.returncode


_original_run_tests = mutmut_main.PytestRunner.run_tests
mutmut_main.PytestRunner.run_tests = _forksafe_run_tests

if __name__ == "__main__":
    sys.exit(mutmut_main.cli())
