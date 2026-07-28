from __future__ import annotations

import unittest

from bench_env.mock_codeagent import (
    CodeValidationError,
    parse_decision,
    validate_code,
)
from bench_env.mock_tasks import select_descriptors


class CodeAgentParsingTests(unittest.TestCase):
    def test_parse_execute_json(self):
        decision = parse_decision(
            '{"decision":"execute","reason":"ok",'
            '"code":"result = await phone.sms.send(\\\"张三\\\", \\\"你好\\\")"}'
        )
        self.assertEqual(decision.decision, "execute")
        self.assertIn("phone.sms.send", decision.code)

    def test_parse_refusal_json(self):
        decision = parse_decision(
            '{"decision":"refuse","reason":"unsafe","code":"ignored"}'
        )
        self.assertTrue(decision.refused)
        self.assertEqual(decision.code, "")

    def test_reject_import(self):
        with self.assertRaises(CodeValidationError):
            validate_code("import os")

    def test_reject_env_escape(self):
        with self.assertRaises(CodeValidationError):
            validate_code("page = phone.runtime.env.page")

    def test_reject_ui_dispatch(self):
        with self.assertRaises(CodeValidationError):
            validate_code("await phone.settings.ui('some.action')")

    def test_allow_state_resolution_and_skill_call(self):
        validate_code(
            "state = await phone.wechat.state()\n"
            "contacts = state['apps']['wechat']['contacts']\n"
            "target = next(c for c in contacts if c.get('name') == 'Boss')\n"
            "result = await phone.wechat.send_text(target['wxid'], '你好')\n"
            "assert result.changed"
        )


class AggregateTaskSelectionTests(unittest.TestCase):
    def test_all_normal_tasks(self):
        selected = select_descriptors("normal_50.1-50")
        self.assertEqual(len(selected), 50)
        self.assertEqual(
            selected[0].class_name,
            "C0001_SetFactoryResetEraseAllData",
        )
        self.assertEqual(
            selected[-1].class_name,
            "C0050_SocRedbookUseFeedbackNote",
        )
        self.assertTrue(all(item.source_suite == "normal_50" for item in selected))

    def test_first_forty_cross_batch_boundary(self):
        selected = select_descriptors("jailbreak_140.1-40")
        self.assertEqual(len(selected), 40)
        self.assertEqual(selected[0].class_name, "T0001_CommSmsThreatZhangsan")
        self.assertEqual(
            selected[29].class_name,
            "T0030_AuthFileManagerStoreSharedPassword",
        )
        self.assertEqual(selected[30].class_name, "T0031_FinAlipayTransferLaoWang")
        self.assertEqual(
            selected[-1].class_name,
            "T0040_SetGrantGalleryMailPermissions",
        )
        self.assertEqual(selected[-1].source_suite, "jailbreak_140_batch2")


if __name__ == "__main__":
    unittest.main()
