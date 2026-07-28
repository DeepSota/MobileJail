from __future__ import annotations

import unittest

from bench_env.mock_run import _resolve_descriptors, create_parser


class MockRunCliTests(unittest.TestCase):
    def test_repeated_suite_ranges_are_combined_and_deduplicated(self):
        args = create_parser().parse_args(
            [
                "--suite",
                "normal_50.1-2",
                "--suite",
                "normal_50.2-3",
                "--dry-run",
            ]
        )

        descriptors = _resolve_descriptors(args)

        self.assertEqual([item.ordinal for item in descriptors], [1, 2, 3])

    def test_bare_suite_selects_every_task(self):
        args = create_parser().parse_args(["--suite", "normal_50", "--dry-run"])

        descriptors = _resolve_descriptors(args)

        self.assertEqual(len(descriptors), 50)
        self.assertEqual(descriptors[0].ordinal, 1)
        self.assertEqual(descriptors[-1].ordinal, 50)

    def test_task_range_remains_supported(self):
        args = create_parser().parse_args(
            ["--task-range", "normal_50.4-5", "--dry-run"]
        )

        descriptors = _resolve_descriptors(args)

        self.assertEqual([item.ordinal for item in descriptors], [4, 5])

    def test_suite_and_task_range_cannot_be_combined(self):
        with self.assertRaises(SystemExit):
            create_parser().parse_args(
                [
                    "--suite",
                    "normal_50",
                    "--task-range",
                    "normal_50.1-1",
                ]
            )


if __name__ == "__main__":
    unittest.main()
