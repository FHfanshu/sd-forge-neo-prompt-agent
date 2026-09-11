from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import test_gate


class TestGateTests(unittest.TestCase):
    def test_registry_and_current_mappings_pass_full_preflight(self):
        result = test_gate.validate_preflight("full")
        self.assertEqual([], result.errors)
        self.assertGreaterEqual(len(result.requirements), 10)

    def test_semantic_pixel_lint_rejects_exact_e2e_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "layout.spec.ts"
            path.write_text("expect(box.x).toBe(0);", encoding="utf-8")
            self.assertIsNotNone(test_gate.EXACT_E2E_PIXEL_RE.search(path.read_text(encoding="utf-8")))

    def test_requirement_paths_match_affected_files(self):
        result = test_gate.validate_preflight("affected")
        impacted = test_gate.impacted_requirements(result, ["frontend/src/components/Surface.svelte"])
        self.assertIn("UI-WINDOW-001", impacted)

    def test_stale_acceptance_warns_in_affected_and_fails_in_full(self):
        requirements = {"UI-WINDOW-001": {"revision": 2}}
        mapping = test_gate.Mapping("frontend/tests/surface.test.ts", "UI-WINDOW-001@1", frozenset({"focus"}))

        self.assertEqual("warning", test_gate.mapping_issue(mapping, requirements, "affected")[0])
        self.assertEqual("error", test_gate.mapping_issue(mapping, requirements, "full")[0])

    def test_windows_command_resolution_accepts_script_shims(self):
        self.assertTrue(test_gate.executable("npx"))

    def test_fast_cli_is_registered(self):
        with patch.object(sys, "argv", ["test_gate.py", "fast"]):
            self.assertEqual("fast", test_gate.parse_args().command)

    def _command_labels(self, files, *, include_e2e, svelte_on_type_or_config):
        result = test_gate.validate_preflight("affected")
        return [
            label
            for label, *_ in test_gate.affected_commands(
                result,
                files,
                include_e2e=include_e2e,
                svelte_on_type_or_config=svelte_on_type_or_config,
            )
        ]

    def test_fast_mode_skips_build_bundle_and_e2e(self):
        labels = self._command_labels(
            ["frontend/src/components/Surface.svelte"],
            include_e2e=False,
            svelte_on_type_or_config=True,
        )
        self.assertIn("Svelte/type check", labels)
        self.assertIn("affected frontend tests", labels)
        self.assertNotIn("affected browser acceptance", labels)
        self.assertNotIn("frontend build", labels)
        self.assertNotIn("bundle budget", labels)

    def test_fast_mode_runs_svelte_check_for_frontend_config(self):
        labels = self._command_labels(
            ["frontend/tsconfig.json"],
            include_e2e=False,
            svelte_on_type_or_config=True,
        )
        self.assertIn("Svelte/type check", labels)

    def test_fast_mode_skips_svelte_check_for_python_only_changes(self):
        labels = self._command_labels(
            ["backend/prompt_agent/app.py"],
            include_e2e=False,
            svelte_on_type_or_config=True,
        )
        self.assertNotIn("Svelte/type check", labels)

    def test_affected_keeps_svelte_check_only_for_frontend_src(self):
        src_labels = self._command_labels(
            ["frontend/src/components/Surface.svelte"],
            include_e2e=True,
            svelte_on_type_or_config=False,
        )
        config_labels = self._command_labels(
            ["frontend/tsconfig.json"],
            include_e2e=True,
            svelte_on_type_or_config=False,
        )
        self.assertIn("Svelte/type check", src_labels)
        self.assertNotIn("Svelte/type check", config_labels)

    def test_test_only_frontend_change_runs_changed_and_mapped_vitest(self):
        result = test_gate.validate_preflight("affected")
        commands = test_gate.affected_commands(
            result,
            ["frontend/tests/surface.test.ts"],
            include_e2e=True,
            svelte_on_type_or_config=False,
        )
        labels = [label for label, *_ in commands]
        self.assertNotIn("Svelte/type check", labels)
        self.assertNotIn("frontend tests", labels)
        frontend = next(command for label, command, *_ in commands if label == "affected frontend tests")
        self.assertIn("tests/surface.test.ts", frontend)
        self.assertGreater(len([arg for arg in frontend if str(arg).endswith(".test.ts")]), 1)

    def test_unmapped_frontend_test_does_not_run_full_suite(self):
        result = test_gate.validate_preflight("affected")
        commands = test_gate.affected_commands(
            result,
            ["frontend/tests/i18n.test.ts"],
            include_e2e=True,
            svelte_on_type_or_config=False,
        )
        labels = [label for label, *_ in commands]
        self.assertEqual(["affected frontend tests"], labels)
        frontend = commands[0][1]
        self.assertEqual(["tests/i18n.test.ts"], [arg for arg in frontend if str(arg).endswith(".test.ts")])

    def test_frontend_config_change_still_falls_back_to_full_vitest_suite(self):
        result = test_gate.validate_preflight("affected")
        commands = test_gate.affected_commands(
            result,
            ["frontend/vitest.config.ts"],
            include_e2e=True,
            svelte_on_type_or_config=False,
        )
        labels = [label for label, *_ in commands]
        self.assertNotIn("Svelte/type check", labels)
        self.assertIn("frontend tests", labels)
        self.assertNotIn("affected frontend tests", labels)

    def test_unmapped_frontend_source_still_falls_back_to_full_vitest_suite(self):
        result = test_gate.validate_preflight("affected")
        commands = test_gate.affected_commands(
            result,
            ["frontend/src/i18n/runtime.ts"],
            include_e2e=True,
            svelte_on_type_or_config=False,
        )
        labels = [label for label, *_ in commands]
        self.assertIn("Svelte/type check", labels)
        self.assertIn("frontend tests", labels)
        self.assertNotIn("affected frontend tests", labels)

    def test_mapped_frontend_source_keeps_mapped_vitest_selection(self):
        result = test_gate.validate_preflight("affected")
        commands = test_gate.affected_commands(
            result,
            ["frontend/src/components/Surface.svelte"],
            include_e2e=True,
            svelte_on_type_or_config=False,
        )
        labels = [label for label, *_ in commands]
        self.assertIn("affected frontend tests", labels)
        self.assertNotIn("frontend tests", labels)
        self.assertIn("affected browser acceptance", labels)


if __name__ == "__main__":
    unittest.main()
