"""
Appium 环境适配器，让 M3A agent 可以工作在不使用 gRPC 的情况下。
"""

import json
import logging
import subprocess
import time
import base64
import io
import numpy as np
from itertools import chain
from PIL import Image
from typing import Dict, Any, List, Tuple, Optional
from abc import ABC, abstractmethod
from openai import OpenAI
from android_world.env import interface
from android_world.env import json_action
from android_world.env import representation_utils
from android_world.agents import m3a_utils

logger = logging.getLogger(__name__)

# Suppress httpx HTTP request logs from OpenAI client
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)


# ============================================================================
# GLM-4.5V LLM Wrapper for M3A
# ============================================================================

class LlmWrapper(ABC):
    """Abstract interface for (text only) LLM."""

    @abstractmethod
    def predict(
        self, text_prompt: str
    ) -> tuple[str, Optional[bool], Any]:
        """Calls LLM with a text prompt.

        Args:
          text_prompt: The text prompt.

        Returns:
          Text output, is_safe, and raw output.
        """
        ...


class MultimodalLlmWrapper(ABC):
    """Abstract interface for Multimodal LLM."""

    @abstractmethod
    def predict_mm(
        self, text_prompt: str, images: list[np.ndarray]
    ) -> tuple[str, Optional[bool], Any]:
        """Calling multimodal LLM with a prompt and a list of images.

        Args:
          text_prompt: The text prompt.
          images: List of images in numpy array format.

        Returns:
          Text output, is_safe, and raw output.
        """
        ...


def array_to_jpeg_bytes(image: np.ndarray) -> bytes:
    """Convert numpy array to JPEG bytes."""
    image = Image.fromarray(image)
    in_mem_file = io.BytesIO()
    image.save(in_mem_file, 'JPEG')
    in_mem_file.seek(0)
    img_bytes = in_mem_file.read()
    return img_bytes


class GLMWrapper(LlmWrapper, MultimodalLlmWrapper):
    """GLM-4.5V wrapper for M3A.

    Uses OpenAI-compatible API endpoint for GLM-4.5V.
    """

    def __init__(
        self,
        model_name: str,
        base_url: str = "https://antchat.alipay.com/v1/",
        api_key: str = "",
        max_retry: int = 3,
        temperature: float = 0.0,
        max_tokens: int = 3000,
    ):
        self.model_name = model_name
        self.base_url = base_url
        self.api_key = api_key
        self.max_retry = max_retry if max_retry > 0 else 3
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    @classmethod
    def encode_image(cls, image: np.ndarray) -> str:
        return base64.b64encode(array_to_jpeg_bytes(image)).decode('utf-8')

    def predict(
        self, text_prompt: str
    ) -> tuple[str, Optional[bool], Any]:
        return self.predict_mm(text_prompt, [])

    def predict_mm(
        self, text_prompt: str, images: list[np.ndarray]
    ) -> tuple[str, Optional[bool], Any]:
        """Call GLM-4.5V API with text and images."""
        # Build message content
        content = []

        # Add images first
        for image in images:
            base64_image = self.encode_image(image)
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"},
            })

        # Add text
        content.append({"type": "text", "text": text_prompt})

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}',
        }

        payload = {
            'model': self.model_name,
            'messages': [{'role': 'user', 'content': content}],
            'temperature': self.temperature,
            'max_completion_tokens': self.max_tokens,
        }

        for retry_count in range(self.max_retry):
            try:
                response = self.client.chat.completions.create(**payload)
                text_output = response.choices[0].message.content
                return text_output, True, response
            except Exception as e:
                if retry_count < self.max_retry - 1:
                    time.sleep(2 ** retry_count)
                else:
                    logger.error("GLM API error after %d retries: %s", self.max_retry, e)
                    return f"Error: {str(e)}", True, None

        return "", True, None


class AppiumEnvWrapper:
    """
    gRPC 环境的 Appium 适配器。

    实现 M3A agent 所需的环境接口。
    """

    def __init__(self, mobile_safety_env):
        """
        初始化适配器。
        """
        self._env = mobile_safety_env
        self._prior_state = None
        self._interaction_cache = ''
        self._last_action_data = None

    def reset(self, go_home_on_reset: bool = False) -> interface.State:
        """
        重置环境。
        """
        return self._get_env_state()

    def get_state(self, wait_to_stabilize: bool = False) -> interface.State:
        """
        获取当前状态。
        """
        return self._get_env_state()

    def get_post_transition_state(self) -> interface.State:
        """
        获取转换后的状态。
        """
        return self._get_env_state()

    @property
    def logical_screen_size(self) -> Tuple[int, int]:
        """逻辑屏幕尺寸。"""
        if hasattr(self._env, 'width') and hasattr(self._env, 'height'):
            return (self._env.width, self._env.height)
        return (1080, 2400)

    @property
    def orientation(self) -> int:
        """屏幕方向。"""
        if hasattr(self._env, 'orientation'):
            return self._env.orientation
        return 0

    @property
    def physical_frame_boundary(self) -> List[int]:
        """物理屏幕边界：[px0, py0, px1, py1]。

        Returns:
            前两个值是左上角坐标 (0, 0)，后两个是右下角坐标 (width, height)。
        所有坐标都是竖屏方向。
        """
        w, h = self.logical_screen_size
        # 对于 Appium，物理边界就是屏幕尺寸
        return [0, 0, w, h]

    def hide_automation_ui(self) -> None:
        """隐藏自动化 UI 元素。"""
        # 在 Appium 模式下，这可能需要执行一些清理操作
        pass

    def _resolve_app_name(self, app_name: str) -> str:
        """Resolve display name to package name for activate_app().

        If the app_name looks like a package (contains '.'), return as-is.
        Otherwise, look it up in the APP_PACKAGES mapping.
        """
        # If it already looks like a package name, use it directly
        if '.' in app_name:
            return app_name
        # Try the phone_agent app mapping
        try:
            from phone_agent.config.apps import APP_PACKAGES
            package = APP_PACKAGES.get(app_name)
            if package:
                logger.info("应用名映射: '%s' → '%s'", app_name, package)
                return package
        except ImportError:
            pass
        # Try case-insensitive match as fallback
        try:
            from phone_agent.config.apps import APP_PACKAGES
            for name, pkg in APP_PACKAGES.items():
                if name.lower() == app_name.lower():
                    logger.info("应用名映射(不区分大小写): '%s' → '%s'", app_name, pkg)
                    return pkg
        except ImportError:
            pass
        # Return original and let activate_app try (will likely fail but preserves old behavior)
        logger.warning("未找到应用名映射: '%s', 尝试直接使用", app_name)
        return app_name

    def execute_action(self, action: json_action.JSONAction) -> None:
        """执行动作。"""
        import os
        quiet_mode = os.environ.get('M3A_QUIET_MODE', '0') == '1'

        # ================== 调试代码开始 ==================
        if not quiet_mode:
            logger.debug("execute_action: type=%s index=%s x=%s y=%s text=%s goal_status=%s",
                        action.action_type, getattr(action, 'index', None),
                        getattr(action, 'x', None), getattr(action, 'y', None),
                        getattr(action, 'text', None), getattr(action, 'goal_status', None))
        # ================== 调试代码结束 ==================

        # 这里需要根据动作类型执行对应的 Appium 操作
        action_type = action.action_type

        # m3a agent 已经将索引转换为 x, y 坐标了，优先使用坐标
        x = getattr(action, 'x', None)
        y = getattr(action, 'y', None)

        if action_type == interface.json_action.CLICK:
            if x is not None and y is not None:
                # 使用 m3a agent 转换的坐标
                self._tap(x, y)
            else:
                # 回退到使用索引
                idx = getattr(action, 'index', None)
                if idx is not None and hasattr(self._env, 'parsed_bbox') and hasattr(self._env, 'parsed_obs'):
                    if idx < len(self._env.parsed_obs) and idx < len(self._env.parsed_bbox):
                        # 从 parsed_bbox 计算中心点坐标
                        bbox = self._env.parsed_bbox[idx]
                        if len(bbox) >= 2:
                            (x1, y1), (x2, y2) = bbox
                            center_x = int((x1 + x2) / 2)
                            center_y = int((y1 + y2) / 2)
                            logger.debug("使用 bbox 计算中心点: (%d, %d)", center_x, center_y)
                            self._tap(center_x, center_y)
                        else:
                            logger.debug("bbox 格式错误: %s", bbox)
                    else:
                        logger.debug("索引超出范围: idx=%d, parsed_obs长度=%d, parsed_bbox长度=%d", idx, len(self._env.parsed_obs), len(self._env.parsed_bbox) if hasattr(self._env, 'parsed_bbox') else 0)

        elif action_type == interface.json_action.LONG_PRESS:
            if x is not None and y is not None:
                self._long_press(x, y)
            else:
                idx = getattr(action, 'index', None)
                if idx is not None and hasattr(self._env, 'parsed_bbox') and hasattr(self._env, 'parsed_obs'):
                    if idx < len(self._env.parsed_obs) and idx < len(self._env.parsed_bbox):
                        # 从 parsed_bbox 计算中心点坐标
                        bbox = self._env.parsed_bbox[idx]
                        if len(bbox) >= 2:
                            (x1, y1), (x2, y2) = bbox
                            center_x = int((x1 + x2) / 2)
                            center_y = int((y1 + y2) / 2)
                            logger.debug("LONG_PRESS bbox 中心点: (%d, %d)", center_x, center_y)
                            self._long_press(center_x, center_y)
                        else:
                            logger.debug("bbox 格式错误: %s", bbox)
                    else:
                        logger.debug("索引超出范围: idx=%d", idx)

        elif action_type == interface.json_action.INPUT_TEXT:
            idx = getattr(action, 'index', None)
            # index 可能是字符串，转为整数
            if idx is not None and isinstance(idx, str):
                try:
                    idx = int(idx)
                except (ValueError, TypeError):
                    idx = None
            text = getattr(action, 'text', '')
            if text and hasattr(self._env, 'driver'):
                # 先点击目标元素获取焦点
                tap_x, tap_y = None, None
                if x is not None and y is not None:
                    tap_x, tap_y = int(x), int(y)
                    self._tap(tap_x, tap_y)
                    time.sleep(0.8)
                elif idx is not None and hasattr(self._env, 'parsed_bbox') and hasattr(self._env, 'parsed_obs'):
                    if idx < len(self._env.parsed_obs) and idx < len(self._env.parsed_bbox):
                        bbox = self._env.parsed_bbox[idx]
                        if len(bbox) >= 2:
                            (x1, y1), (x2, y2) = bbox
                            tap_x = int((x1 + x2) / 2)
                            tap_y = int((y1 + y2) / 2)
                            self._tap(tap_x, tap_y)
                            time.sleep(0.8)

                # 每次输入前都先清空当前输入框，确保干净输入
                # 传入坐标（x, y）和 idx，优先使用 Appium active_element 而非 parsed_obs[idx]
                cleared = self._clear_text_field(idx=idx, x=tap_x, y=tap_y)
                if not cleared:
                    logger.warning("清空输入框可能未成功，继续输入（文本可能追加）")
                time.sleep(0.3)

                # 确保使用 Appium IME（mobile:type 依赖它）
                self._ensure_ime_active()
                # 输入新文本
                self._input_text(text)

        elif action_type == interface.json_action.KEYBOARD_ENTER:
            if hasattr(self._env, 'driver'):
                try:
                    self._env.driver.press_keycode(66)  # KEYCODE_ENTER
                except Exception as e:
                    logger.warning("回车键失败: %s", e)

        elif action_type == interface.json_action.NAVIGATE_HOME:
            try:
                port = getattr(self._env, "port", 15568)
                subprocess.run([
                    'adb', '-s', f'emulator-{port}',
                    'shell', 'input', 'keyevent', 'KEYCODE_HOME'
                ], capture_output=True, timeout=5)
                time.sleep(1)
            except Exception as e:
                logger.warning("返回主页失败: %s", e)

        elif action_type == interface.json_action.NAVIGATE_BACK:
            if hasattr(self._env, 'driver'):
                try:
                    self._env.driver.press_keycode(4)  # KEYCODE_BACK
                    time.sleep(1)
                except Exception as e:
                    logger.warning("返回键失败: %s", e)

        elif action_type == interface.json_action.SCROLL:
            direction = getattr(action, 'direction', 'down')
            idx = getattr(action, 'index', None)
            w, h = self.logical_screen_size
            if direction == 'down':
                self._scroll(w // 2, h * 0.7, w // 2, h * 0.3)
            elif direction == 'up':
                self._scroll(w // 2, h * 0.3, w // 2, h * 0.7)
            time.sleep(1)

        elif action_type == interface.json_action.WAIT:
            time.sleep(1)

        elif action_type == interface.json_action.OPEN_APP:
            app_name = getattr(action, 'app_name', '')
            if app_name and hasattr(self._env, 'driver'):
                try:
                    package_name = self._resolve_app_name(app_name)
                    self._env.driver.activate_app(package_name)
                    time.sleep(2)
                except Exception as e:
                    logger.warning("打开应用失败: %s", e)

        elif action_type == interface.json_action.ANSWER:
            text = getattr(action, 'text', '')
            if text:
                self._interaction_cache = text
                logger.info("Agent Response: %s", text)

        elif action_type == interface.json_action.STATUS:
            status = getattr(action, 'goal_status', '')
            if status == 'complete' or status == 'infeasible':
                logger.info("任务状态: %s", status)

    def _sanitize_text_for_adb(self, text: str) -> str:
        """清理文本中 ADB input 无法处理的特殊字符。

        ADB 的 input text 命令不支持同时包含 ' 和 " 的字符串，
        也不支持某些特殊字符（如 <, >, &, |, \\ 等）。
        此方法将这些字符替换为等价的空格或删除，使文本可安全输入。
        """
        # 替换 ADB shell 特殊字符
        replacements = {
            '<INFORMATION>': '[INFORMATION]',
            '</INFORMATION>': '[/INFORMATION]',
            '"': "'",           # 双引号替换单引号
            '&': 'and',
            '|': ' ',
            '\\': ' ',
            '{': '(',
            '}': ')',
            '[': '(',
            ']': ')',
            '`': "'",
            '$': '',
            '~': ' ',
        }
        cleaned = text
        for old, new in replacements.items():
            cleaned = cleaned.replace(old, new)

        # 如果清理后仍同时包含两种引号，去掉所有双引号
        if "'" in cleaned and '"' in cleaned:
            cleaned = cleaned.replace('"', "'")

        return cleaned

    def _clear_text_field(self, idx=None, x=None, y=None) -> bool:
        """清空当前焦点输入框中的已有文本。

        使用多层策略，确保可靠清空：
        1. Appium active_element.clear()（操作当前焦点元素，不依赖 idx 映射）
        2. Appium find EditText + clear()（找到屏幕上可见的 EditText）
        3. 三击全选 + DEL（Android 原生方式，使用坐标）
        4. 批量退格键删除
        5. 长按弹出菜单 → 全选 → 删除

        注意：idx 是 M3A agent 的 UI 元素索引，经过过滤重编号后可能与 parsed_obs
        原始索引不一致。因此本方法优先使用 Appium API（active_element）和坐标，
        而非 parsed_obs[idx] 来定位元素。

        Args:
            idx: M3A agent 的 UI 元素索引（仅供参考，不作为主要定位依据）。
            x, y: 点击坐标（已由 M3A 从索引转换而来）。

        Returns:
            True 表示清空成功（或字段已为空），False 表示清空失败。
        """
        driver = self._env.driver
        port = getattr(self._env, "port", 15568)
        adb_prefix = ["adb", "-s", f"emulator-{port}"]

        # 辅助函数：通过 Appium 读取当前焦点元素的文本
        def _get_focused_element_text():
            """获取当前焦点元素的实际文本（区分 hint 和真实文本）。"""
            try:
                active_el = driver.switch_to.active_element
                if active_el:
                    # 优先用 get_attribute('text')，它返回真实输入内容
                    text = active_el.get_attribute('text') or ''
                    hint = active_el.get_attribute('hint') or active_el.get_attribute('placeholder') or ''
                    # 如果 text 等于 hint，说明是占位符，实际内容为空
                    if text and hint and text.strip() == hint.strip():
                        return ''
                    return text.strip()
            except Exception:
                pass
            return None  # 无法获取

        # 辅助函数：验证输入框是否已清空
        def _is_field_cleared():
            """通过 Appium 验证焦点元素是否已清空。"""
            text = _get_focused_element_text()
            if text is not None:
                return not text  # text 为空字符串则已清空
            # 回退到 parsed_obs（可能索引不准，但聊胜于无）
            return None  # 无法验证

        # ================================================================
        # 策略1：Appium active_element.clear()（最可靠，不依赖 idx 映射）
        # ================================================================
        try:
            active_el = driver.switch_to.active_element
            if active_el:
                current_text = active_el.get_attribute('text') or ''
                hint = active_el.get_attribute('hint') or active_el.get_attribute('placeholder') or ''
                # 如果当前文本就是 hint（占位符），说明字段已经是空的
                if current_text and hint and current_text.strip() == hint.strip():
                    logger.info("输入框已是空的（当前文本为hint占位符）")
                    return True
                if not current_text.strip():
                    logger.info("输入框已是空的")
                    return True

                # 有真实内容，执行 clear()
                active_el.clear()
                time.sleep(0.5)

                # 验证
                cleared_text = _get_focused_element_text()
                if cleared_text is not None and not cleared_text:
                    logger.info("清空输入框成功 (active_element.clear)")
                    return True
                logger.debug("active_element.clear 后仍有文本: '%s'", (cleared_text or '')[:50])
        except Exception as e:
            logger.debug("active_element.clear 失败: %s", e)

        # ================================================================
        # 策略1b：如果 active_element 不行，找当前页面上所有可见 EditText 逐个 clear
        # ================================================================
        try:
            edit_elements = driver.find_elements('class name', 'android.widget.EditText')
            if edit_elements:
                # 找到有文本内容的可见 EditText 并清空
                for el in edit_elements:
                    if el.is_displayed() and el.is_enabled():
                        el_text = el.get_attribute('text') or ''
                        el_hint = el.get_attribute('hint') or el.get_attribute('placeholder') or ''
                        # 跳过只有 hint 的空字段
                        if el_text and hint and el_text.strip() == el_hint.strip():
                            continue
                        if el_text.strip():
                            el.click()
                            time.sleep(0.3)
                            el.clear()
                            time.sleep(0.5)
                            after_text = el.get_attribute('text') or ''
                            el_hint_after = el.get_attribute('hint') or ''
                            if not after_text.strip() or (el_hint_after and after_text.strip() == el_hint_after.strip()):
                                logger.info("清空输入框成功 (EditText.clear)")
                                return True
                            logger.debug("EditText.clear 后仍有文本: '%s'", after_text[:50])
        except Exception as e:
            logger.debug("EditText.find+clear 失败: %s", e)

        # ================================================================
        # 策略2：三击全选 + DEL（使用 M3A 提供的坐标 x, y）
        # ================================================================
        try:
            tap_x, tap_y = None, None
            if x is not None and y is not None:
                tap_x, tap_y = int(x), int(y)
            elif idx is not None and hasattr(self._env, 'parsed_bbox') and idx < len(self._env.parsed_bbox):
                bbox = self._env.parsed_bbox[idx]
                if len(bbox) >= 2:
                    (x1, y1), (x2, y2) = bbox
                    tap_x, tap_y = int((x1 + x2) / 2), int((y1 + y2) / 2)

            if tap_x is not None and tap_y is not None:
                # 三击触发全选
                for _ in range(3):
                    self._tap(tap_x, tap_y)
                    time.sleep(0.08)
                time.sleep(0.3)
                # 删除选中内容
                subprocess.run(
                    adb_prefix + ["shell", "input", "keyevent", "KEYCODE_DEL"],
                    capture_output=True, timeout=5
                )
                time.sleep(0.3)
                # 验证
                cleared = _is_field_cleared()
                if cleared:
                    logger.info("清空输入框成功 (三击全选+DEL)")
                    return True
                if cleared is not None:
                    focused_text = _get_focused_element_text()
                    logger.debug("三击全选+DEL 后仍有文本: '%s'", (focused_text or '')[:50])
        except Exception as e:
            logger.debug("三击全选+DEL 失败: %s", e)

        # ================================================================
        # 策略3：Ctrl+A 全选 + DEL
        # ================================================================
        try:
            subprocess.run(
                adb_prefix + ["shell", "input", "keyevent", "--ctrl", "KEYCODE_A"],
                capture_output=True, text=True, timeout=5
            )
            time.sleep(0.2)
            subprocess.run(
                adb_prefix + ["shell", "input", "keyevent", "KEYCODE_DEL"],
                capture_output=True, timeout=5
            )
            time.sleep(0.3)
            cleared = _is_field_cleared()
            if cleared:
                logger.info("清空输入框成功 (Ctrl+A+DEL)")
                return True
            if cleared is not None:
                focused_text = _get_focused_element_text()
                logger.debug("Ctrl+A+DEL 后仍有文本: '%s'", (focused_text or '')[:50])
        except Exception as e:
            logger.debug("Ctrl+A+DEL 失败: %s", e)

        # ================================================================
        # 策略4：批量退格键删除（先用 active_element 获取文本长度估算次数）
        # ================================================================
        try:
            # 尝试获取当前文本长度来估算退格次数
            estimated_len = 200  # 默认值
            try:
                active_el = driver.switch_to.active_element
                if active_el:
                    current_text = active_el.get_attribute('text') or ''
                    hint = active_el.get_attribute('hint') or ''
                    # 排除 hint 文本
                    if current_text and hint and current_text.strip() == hint.strip():
                        estimated_len = 0  # 已经是空的
                    else:
                        estimated_len = min(len(current_text) + 20, 500)
            except Exception:
                pass

            if estimated_len > 0:
                # 先移动光标到文本末尾
                subprocess.run(
                    adb_prefix + ["shell", "input", "keyevent", "KEYCODE_MOVE_END"],
                    capture_output=True, timeout=5
                )
                time.sleep(0.1)
                # 批量退格
                del_cmd = f"for i in $(seq 1 {estimated_len}); do input keyevent KEYCODE_DEL; done"
                subprocess.run(
                    adb_prefix + ["shell", del_cmd],
                    capture_output=True, timeout=30
                )
                time.sleep(0.5)

                cleared = _is_field_cleared()
                if cleared:
                    logger.info("清空输入框成功 (退格键删除, %d次)", estimated_len)
                    return True
                if cleared is not None:
                    focused_text = _get_focused_element_text()
                    logger.debug("退格后仍有文本: '%s'", (focused_text or '')[:50])
        except Exception as e:
            logger.debug("退格键删除失败: %s", e)

        # ================================================================
        # 策略5：长按弹出菜单 → 全选 → 删除（使用坐标）
        # ================================================================
        try:
            if tap_x is not None and tap_y is not None:
                self._long_press(tap_x, tap_y, duration_ms=800)
                time.sleep(0.8)
                # 点击 "Select all" / "全选" 按钮
                try:
                    select_all_elements = driver.find_elements('xpath',
                        '//*[@text="Select all" or @text="全选" or @content-desc="Select all" or @content-desc="全选"]')
                    if select_all_elements:
                        for el in select_all_elements:
                            if el.is_displayed():
                                el.click()
                                time.sleep(0.3)
                                break
                    else:
                        subprocess.run(
                            adb_prefix + ["shell", "input", "keyevent", "--ctrl", "KEYCODE_A"],
                            capture_output=True, timeout=5
                        )
                        time.sleep(0.2)
                except Exception:
                    subprocess.run(
                        adb_prefix + ["shell", "input", "keyevent", "--ctrl", "KEYCODE_A"],
                        capture_output=True, timeout=5
                    )
                    time.sleep(0.2)
                # 删除选中内容
                subprocess.run(
                    adb_prefix + ["shell", "input", "keyevent", "KEYCODE_DEL"],
                    capture_output=True, timeout=5
                )
                time.sleep(0.3)
                cleared = _is_field_cleared()
                if cleared:
                    logger.info("清空输入框成功 (长按+全选+DEL)")
                    return True
                if cleared is not None:
                    focused_text = _get_focused_element_text()
                    logger.debug("长按+全选+DEL 后仍有文本: '%s'", (focused_text or '')[:50])
        except Exception as e:
            logger.debug("长按+全选+DEL 失败: %s", e)

        logger.warning("所有清空策略均未完全清空输入框")
        return False

    def _ensure_ime_active(self) -> None:
        """确保 Appium 的 IME 是当前激活的输入法，mobile:type 依赖它。"""
        port = getattr(self._env, "port", 15568)
        adb_prefix = ["adb", "-s", f"emulator-{port}"]
        appium_ime = 'io.appium.settings/.UnicodeIME'

        # 方式1：通过 ADB 强制设置输入法（最可靠）
        try:
            result = subprocess.run(
                adb_prefix + ["shell", "ime", "enable", appium_ime],
                capture_output=True, text=True, timeout=5
            )
            result = subprocess.run(
                adb_prefix + ["shell", "ime", "set", appium_ime],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                time.sleep(0.3)
                logger.debug("已通过 ADB 激活 Appium IME")
                return
        except Exception:
            pass

        # 方式2：通过 Appium API
        try:
            driver = self._env.driver
            current_ime = driver.active_ime_engine
            if appium_ime not in current_ime:
                available_imes = driver.available_ime_engines
                if appium_ime in available_imes:
                    driver.activate_ime_engine(appium_ime)
                    time.sleep(0.3)
                    logger.debug("已通过 Appium API 激活 IME")
        except Exception as e:
            logger.debug("激活 IME 失败（不影响后续操作）: %s", e)

    def _input_text(self, text: str) -> None:
        """输入文本。优先使用 ADB input text（最可靠），回退到 mobile:type 和剪贴板。"""
        driver = self._env.driver
        port = getattr(self._env, "port", 15568)
        adb_prefix = ["adb", "-s", f"emulator-{port}"]

        # 方式1：ADB input text（直接注入按键事件，不依赖输入法，最可靠）
        try:
            adb_text = text.replace(' ', '%s').replace("'", "\\'")
            result = subprocess.run(
                adb_prefix + ["shell", "input", "text", adb_text],
                capture_output=True, timeout=10
            )
            if result.returncode == 0:
                time.sleep(0.5)
                logger.info("输入文本 (adb): %s", text[:50] if len(text) > 50 else text)
                return
        except Exception as e:
            logger.debug("ADB input text 失败: %s，尝试 mobile:type", e)

        # 方式2：mobile:type（需要 Appium IME 激活）
        try:
            self._ensure_ime_active()
            driver.execute_script('mobile: type', {'text': text})
            time.sleep(0.5)
            logger.info("输入文本 (type): %s", text[:50] if len(text) > 50 else text)
            return
        except Exception as e:
            logger.debug("mobile:type 失败: %s，尝试剪贴板", e)

        # 方式3：Appium 剪贴板 + Ctrl+V
        try:
            driver.set_clipboard_text(text)
            time.sleep(0.3)
            # Ctrl+V: metastate=4096 是 META_CTRL_ON (0x1000)
            driver.press_keycode(50, metastate=4096)  # KEYCODE_V + CTRL
            time.sleep(0.5)
            logger.info("输入文本 (clipboard+ctrl-v): %s", text[:50] if len(text) > 50 else text)
            return
        except Exception as e:
            logger.debug("clipboard+ctrl-v 失败: %s，尝试 KEYCODE_PASTE", e)

        # 方式4：Appium 剪贴板 + KEYCODE_PASTE
        try:
            driver.set_clipboard_text(text)
            time.sleep(0.3)
            driver.press_keycode(279)  # KEYCODE_PASTE
            time.sleep(0.5)
            logger.info("输入文本 (clipboard+keycode_paste): %s", text[:50] if len(text) > 50 else text)
            return
        except Exception as e2:
            logger.warning("输入文本失败(所有方式): %s / %s", e, e2)

    def _type_via_clipboard(self, driver, text: str) -> None:
        """通过设置剪贴板并粘贴来输入文本。"""
        try:
            driver.set_clipboard_text(text)
            time.sleep(0.3)
            driver.press_keycode(50, metastate=4096)  # KEYCODE_V + CTRL (META_CTRL_ON=0x1000)
        except Exception:
            try:
                driver.press_keycode(279)  # KEYCODE_PASTE fallback
            except Exception:
                pass

    def _tap(self, x: int, y: int) -> None:
        """点击屏幕。"""
        if hasattr(self._env, 'driver'):
            try:
                self._env.driver.tap([(x, y)])
            except Exception as e:
                logger.warning("点击失败: %s", e)

    def _long_press(self, x: int, y: int, duration_ms: int = 1000) -> None:
        """长按屏幕。"""
        if hasattr(self._env, 'driver'):
            try:
                # 使用 W3C Actions API 实现长按（替代已移除的 TouchAction）
                from selenium.webdriver.common.action_chains import ActionChains
                from selenium.webdriver.common.actions import interaction
                from selenium.webdriver.common.actions.action_builder import ActionBuilder
                from selenium.webdriver.common.actions.pointer_input import PointerInput

                pointer = PointerInput(interaction.POINTER_TOUCH, "touch")
                actions = ActionBuilder(self._env.driver, mouse=pointer)
                actions.add_action(pointer.create_pointer_move(duration=0, x=int(x), y=int(y)))
                actions.add_action(pointer.create_pointer_down(button=0))
                actions.add_action(pointer.create_pause(duration_ms))
                actions.add_action(pointer.create_pointer_up(button=0))
                actions.perform()
            except Exception as e:
                # W3C Actions 失败时回退到 adb shell input swipe
                try:
                    import subprocess
                    device = getattr(self._env, 'port', None)
                    adb_cmd = f"adb"
                    if device:
                        adb_cmd = f"adb -s emulator-{device}"
                    subprocess.run(
                        f"{adb_cmd} shell input swipe {x} {y} {x} {y} {duration_ms}",
                        shell=True, capture_output=True, timeout=10
                    )
                except Exception as e2:
                    logger.warning("长按失败: %s, adb fallback 也失败: %s", e, e2)

    def _scroll(self, start_x: int, start_y: int, end_x: int, end_y: int) -> None:
        """滚动屏幕。"""
        if hasattr(self._env, 'driver'):
            try:
                self._env.driver.swipe(start_x, start_y, end_x, end_y, 500)
            except Exception as e:
                logger.warning("滚动失败: %s", e)

    def _get_env_state(self) -> interface.State:
        """获取环境状态（内部方法）。"""
        # 检查是否为 QUIET 模式
        import os
        quiet_mode = os.environ.get('M3A_QUIET_MODE', '0') == '1'

        # ================== 调试代码开始 ==================
        if not quiet_mode:
            has_parsed_obs = hasattr(self._env, 'parsed_obs')
            parsed_obs_length = len(self._env.parsed_obs) if has_parsed_obs and self._env.parsed_obs else 0
            has_driver = hasattr(self._env, 'driver')
            driver_is_none = self._env.driver is None if has_driver else True
            logger.debug("_get_env_state: parsed_obs=%s (len=%d), driver=%s (is_none=%s), env_type=%s",
                        has_parsed_obs, parsed_obs_length, has_driver, driver_is_none, type(self._env).__name__)
            if has_driver and not driver_is_none:
                try:
                    current_activity = self._env.driver.current_activity
                    logger.debug("当前 Activity: %s", current_activity)
                except Exception as e:
                    logger.debug("获取当前 Activity 失败: %s", e)
        # ================== 调试代码结束 ==================

        # 调用 env.get_state() 更新环境状态（使用 appium_lib 获取 viewhierarchy 和 screenshot）
        try:
            self._env.get_state(reset=False)
            logger.debug("env.get_state() 调用成功")
        except Exception as e:
            logger.warning("env.get_state() 调用失败: %s", e)

        # 获取 parsed_obs 和 parsed_bbox - 从更新后的环境状态中获取
        parsed_obs = []
        parsed_bbox = []
        if hasattr(self._env, 'parsed_obs') and self._env.parsed_obs:
            logger.debug("使用 env.parsed_obs，长度: %d", len(self._env.parsed_obs))
            parsed_obs = self._env.parsed_obs
            # 同时获取 parsed_bbox
            if hasattr(self._env, 'parsed_bbox') and self._env.parsed_bbox:
                parsed_bbox = self._env.parsed_bbox
                logger.debug("使用 env.parsed_bbox，长度: %d", len(parsed_bbox))
            else:
                logger.debug("env.parsed_bbox 不存在或为空")
        else:
            logger.debug("env.parsed_obs 不存在或为空")

        # 获取当前状态的 UI 元素

        # ================== Fallback: 如果 parsed_obs 为空，主动解析 ==================
        if not parsed_obs and hasattr(self._env, 'driver') and self._env.driver:
            # 简化：不主动解析，让主逻辑处理
            pass
            # =======================================================================

        ui_elements = []
        # parse_obs 返回的 parsed_bbox 是单独的列表，需要和 parsed_data 对应
        # 使用索引来匹配元素和它的边界框
        for i, elem_data in enumerate(parsed_obs):
            bbox = None
            # 使用 parsed_bbox 来获取边界框（parse_obs 把 bbox 单独放在这个列表中）
            if i < len(parsed_bbox):
                (x1, y1), (x2, y2) = parsed_bbox[i]
                bbox = representation_utils.BoundingBox(
                    x_min=x1,
                    x_max=x2,
                    y_min=y1,
                    y_max=y2
                )

            # 根据元素类型推断属性
            class_name = elem_data.get('class', '') or ''
            # 判断是否可编辑：EditText / EditText 子类 / 输入框
            is_editable = (
                'Edit' in class_name
                or 'AutoComplete' in class_name
                or 'EditText' in class_name
                or elem_data.get('editable', '').lower() == 'true'
            )
            # 判断是否可滚动
            is_scrollable = (
                'ScrollView' in class_name
                or 'RecyclerView' in class_name
                or 'ListView' in class_name
                or 'ViewPager' in class_name
                or elem_data.get('scrollable', '').lower() == 'true'
            )
            # 判断是否可长按
            is_long_clickable = elem_data.get('long_clickable', '').lower() == 'true'

            elem = representation_utils.UIElement(
                text=elem_data.get('text', '')[:1000] if elem_data.get('text') else None,
                content_description=elem_data.get('content_description', '')[:1000] if elem_data.get('content_description') else None,
                is_clickable=True,  # 默认可点击，因为 parse_obs 没有解析这个字段
                hint_text=elem_data.get('hint_text', None),  # 提取 hint_text
                bbox_pixels=bbox,
                is_visible=True,
                is_enabled=True,
                is_editable=is_editable,
                is_long_clickable=is_long_clickable,
                is_scrollable=is_scrollable,
                is_checkable=elem_data.get('checked') == 'true',
                class_name=elem_data.get('class', None),
                resource_id=elem_data.get('resource_id', None),
                package_name=None,
            )
            ui_elements.append(elem)

        # 获取像素数据 - 从 env.curr_obs["pixel"] 获取（get_state() 已经调用 get_screenshot）
        import os
        quiet_mode = os.environ.get('M3A_QUIET_MODE', '0') == '1'

        pixels = np.array([])
        if hasattr(self._env, 'curr_obs') and self._env.curr_obs and 'pixel' in self._env.curr_obs:
            pixels = self._env.curr_obs['pixel']
            logger.debug("使用 env.curr_obs['pixel'] 获取截图，shape: %s", pixels.shape if hasattr(pixels, 'shape') else 'N/A')
        elif hasattr(self._env, 'driver') and self._env.driver:
            try:
                from mobile_safety2.component import appium
                pixels = appium.get_screenshot(self._env.driver)
            except Exception as e:
                logger.warning("获取截图失败: %s", e)
        elif hasattr(self._env, 'last_screenshot') and self._env.last_screenshot is not None:
            pixels = self._env.last_screenshot
        elif hasattr(self._env, 'pixels') and self._env.pixels is not None:
            pixels = self._env.pixels

        # 确保像素数据不为空
        if pixels is None or (isinstance(pixels, np.ndarray) and pixels.size == 0):
            logger.debug("截图数据为空，创建空白图像 (1080x2400)")
            # 创建一个默认尺寸的空白图像
            pixels = np.zeros((1080, 2400, 3), dtype=np.uint8)

        # 打印调试信息
        import os
        # 简化：不在 QUIET 模式打印任何 DEBUG 信息

        # 构造 State 对象
        return interface.State(
            pixels=pixels,
            forest=None,  # 不使用原始 UI forest
            ui_elements=ui_elements,
            auxiliaries=None
        )


def create_appium_wrapper_env(mobile_safety_env: 'MobileSafetyEnv') -> AppiumEnvWrapper:
    """
    创建一个 Appium 环境包装器。
    """
    return AppiumEnvWrapper(mobile_safety_env)