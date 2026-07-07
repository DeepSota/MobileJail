# bench_env 任务编写指南

> 这是编写 bench_env 任务的**工作流指南**——审计 App、补齐辅助方法、编写任务类、调优采样，然后测试。
>
> 硬性要求参见 [`TASK_CODE_SPEC.md`](TASK_CODE_SPEC.md)。本指南在涉及工作流时会简要重复某条规则；代码规范是审查的权威来源。
>
> 伴随文档：
> - 硬性规则 / 禁止模式 / 最终清单：[`TASK_CODE_SPEC.md`](TASK_CODE_SPEC.md)
> - 测试工作流：[`TASK_TESTING_GUIDE.md`](TASK_TESTING_GUIDE.md)
> - 接地评估（`answer_fields`）：[`GROUNDED_MODE.md`](GROUNDED_MODE.md)
> - 框架架构与生命周期：[`../FRAMEWORK.md`](../FRAMEWORK.md)
> - 类型 / CLI / 路径表达式 / 动作映射：[`../REFERENCE.md`](../REFERENCE.md)

---

## 0. 完整任务长什么样

这是本文档的**参考实现**，后续章节会引用其中的具体行。

```python
# bench_env/task/wechat/defs/SendCodeToFriend.py
from __future__ import annotations
from typing import Any

from bench_env.task import BaseTask
from bench_env.task.judge import JudgeInput
from bench_env.task.wechat.app import (
    Wechat,
    WECHAT_CONTACT_PARAM,
    WECHAT_SEND_CHANGES,
)


class SendCodeToFriend(BaseTask):
    """判定：微信新消息发给 {contact}，包含6位验证码 {code}。"""

    # ---- 模板与 App ----
    templates = ["向「{contact}」发送验证码 {code}"]
    apps = ["wechat"]

    # ---- 元数据 ----
    scope = "S1"
    objective = "operate"
    composition = "atomic"
    difficulty = "L3"
    max_steps = 30  # 可选；省略则使用难度默认值
    capabilities = ["social"]

    # ---- 参数 ----
    parameters = {
        "contact": WECHAT_CONTACT_PARAM,                              # 复用 app.py 中的共享参数
        "code": {"type": "string", "pattern": r"\d{6}", "default": "123456"},
    }

    # ---- 副作用声明 ----
    expected_changes = WECHAT_SEND_CHANGES

    # ---- 判定 ----
    def check_goals(self, input: JudgeInput) -> list[dict[str, Any]]:
        wechat = Wechat(input.apps["wechat"], init=input.apps_init["wechat"])
        return [
            wechat.check_new_sent_contains(
                self.p.contact, self.p.code, field="verification_code",
            ),
        ]
```

任务文件只做四件事：**声明模板/元数据、声明参数、声明副作用、调用 App 辅助方法**。所有数据查找、聚合和与 schema 耦合的验证逻辑都放在 `wechat/app.py` 中——此处引用的 `WECHAT_CONTACT_PARAM`、`WECHAT_SEND_CHANGES` 和 `Wechat.check_new_sent_contains()` 都是 `task/wechat/app.py` 中真实的辅助方法。

> **何时需要 `_prepare`？**：上面的示例没有，因为 `defaults.json` 默认就有联系人供 `WECHAT_CONTACT_PARAM`（内部由 `Wechat.sample_friend_name` 支撑）采样。只有在采样器需要特定的已置入数据时（例如"任务需要一个有未读消息的联系人"）才添加 `_prepare`——调用对应 App 的 `prepare_state_with_*` 辅助方法。参见 §5.6。

新任务的一般工作流是：审计 App（§1）→ 补齐 app.py 辅助方法（§2）→ 选择 `tasks.py` 或 `defs/`（§3）→ 编写任务类（§4）→ 调优采样（§5）。

---

## 1. 第一步：审计 App 的功能与数据接口

写任何东西之前，你必须理解 **App 能做什么**、**从状态中能读什么**、**以及已有哪些辅助方法**。跳过审计就像凭记忆出考题。

### 1.1 需要阅读的文件

| 来源 | 关注什么 |
|---|---|
| `apps/<AppDir>/navigation.declaration.ts` | 所有路由、UI 状态、动作 ID（用于 `optimal_paths`、`criteria.route`） |
| `apps/<AppDir>/data/defaults.json` | 默认数据条目（采样池大小、字段完备性） |
| `apps/<AppDir>/data/index.ts` / `state.ts` | **通过增强 / store action 派生的字段**（可用于判定） |
| `apps/<AppDir>/types.ts` | 状态 schema |
| `bench_env/task/<suite>/app.py` | 现有的数据方法 / 答案方法 / `check_*` 方法 |

> ⚠️ **管线感知**：状态流经 `defaults.json → data/index.ts（增强）→ store → bench_env state`。很多字段在增强阶段就已经派生好了（例如 Alipay 的 `category`、`displayTitle`）。**在编写判定逻辑之前，先检查目标字段是否已经存在**——读一读现有的，不要在 Python 中重新派生。

### 1.2 列出 CRUD 能力

将 App 的操作归类为 **C/R/U/D + Q（查询）**，并标记哪些可以从状态可靠判定：

```
Wechat:
  C  发送消息 → chats[].messages 中新增条目    ✓ 可判定
  C  发朋友圈 → moments 中新增条目             ✓ 可判定
  U  改名     → user.profile.nickname          ✓ 可判定
  U  拉黑     → contacts[wxid=X].isBlacklisted  ✓ 可判定
  D  删除聊天 → chats 缩小                     ✓ 可判定（diff）
  Q  联系人数量                                ✓ 可判定（.contacts len）
  -  滑动朋友圈                                ✗ 无稳定状态痕迹
```

**可判定能力列表**驱动后续所有判定决策——只有能从状态稳定派生的能力才能用于任务。

### 1.3 数据充分性检查

| 检查项 | 不充分的信号 | 行动 |
|---|---|---|
| 集合大小 | 想"比较3个城市"但 `savedCities` 只有2个 | 扩展 `defaults.json` 或改为"先添加再比较" |
| 多样性 | 只有3个联系人；无法采样变体 | 添加更多条目 |
| 字段完备性 | 想"昨天收益"但 `defaults.json` 缺少该字段 | 先加字段，再设计任务 |

**原则**：任务设计不仅仅关于 UI 能做什么——数据也必须支撑。优先扩展 `defaults.json`；不要在 `_prepare()` 中塞入可能与默认数据偏离的硬编码副本（参见 §5.6 / `_prepare` 纪律）。

### 1.4 跨 App 套件的特点

跨 App 套件（`task/crossapp_life/` 等）**没有自己的状态**。所有数据来自各个 App。

| 区别 | 单 App 套件 | 跨 App 套件 |
|---|---|---|
| `app.py` | 必需；继承 `BaseApp` | **通常省略**；仅在有不属于任何单个 App 的套件私有逻辑时才创建 |
| `check_*` 来源 | 本套件的 App 类 | 各个 App 的类 |

**核心规则**：

1. **复用各 App 已有的 `check_*` / 数据 / 答案方法**。跨 App 任务的 `check_goals()` 实例化多个 App 类，调用它们的方法，仅在此基础上组合/分支。
2. **缺什么 check 方法就加在对应 App 的 `app.py` 里**，不要内联写在跨 App 的 `tasks.py` 中。这样每个 App 的验证逻辑集中在一处，可被单 App 任务复用。
3. **先加辅助方法，再写任务**——绝对不要"先内联，以后再重构"。

---

## 2. 第二步：在 app.py 中编写辅助方法

审计之后，**在写任务之前先补齐 `app.py` 中的辅助方法**。任务类只组合，不计算。

### 2.1 三层 App 辅助方法

每个 App 类（`BaseApp` 子类）提供三层，每层建立在上层之上：

```
数据方法（返回原始数据）
   ↓
答案方法（返回判定器可直接使用的值）
   ↓
检查方法（返回标准检查字典）
```

此外还有单独的安装辅助类别（`prepare_state_with_*`），用于与 schema 耦合的状态变更。

> **App 类命名**：匹配 `manifest.id`，PascalCase，**不带** `App` 后缀（`Wechat`，不是 `WechatApp`；`Railway12306`，不是 `RailwayApp`）。

### 2.2 数据方法（原始数据）

**需要封装**：

- 多步查找（调用方不应关心中间步骤）：`last_text_to(contact)` 内部做 wxid 查找 → 聊天匹配 → 消息过滤
- 结构复杂的读取（带 fallback / 模糊匹配 / 类型转换 + 校验）：`find_contact_wxid(name)`、`current_temp(city)`
- 整洁的数据聚合：`monthly_expense(month)`、`count_rainy_days(days)`——**即使目前只有一个任务使用它**，任何涉及遍历或聚合的逻辑都属于 App 类
- init 与 current 的差异（通用比较）：`new_alarms()`、`removed_alarm_ids()`

**不需要封装**（直接用 `app.get()`）：

- 路径本身就是语义；无结构复杂度：`app.get("settings.darkMode")`
- 不需要校验/转换的单层属性读取

**决策标准**：封装的正当理由是**隐藏结构复杂度或提供校验**，而不是给字段换个更好听的名字。

**缺失数据必须抛异常**：

```python
class Map(BaseApp):
    def place_address(self, name) -> str:
        place = self._find_place(name)
        if not place:
            raise ValueError(f"Place {name!r} not found in state")
        return place["address"]
```

不要静默返回 `""` 或 `None` 让任务去猜——参见 [`TASK_CODE_SPEC.md`](TASK_CODE_SPEC.md) §4 中的错误处理规则。

### 2.3 答案方法（判定就绪的答案）

答案方法构建在数据方法之上，**将原始数据转换为 `get_answer()` / `check_goals()` 可以直接使用的值**。区别：

- **数据方法**返回原始数据（一个温度值、一个日期字符串）
- **答案方法**返回格式化的判定就绪答案（带平局正则、单位转换、同义词覆盖等）

**命名约定**：`<action>_answer` 或 `<scenario>_answer`。

```python
class Weather(BaseApp):
    def hotter_city(self, c1, c2) -> tuple[str, float, float]:
        """数据方法：返回 (胜者, 温度1, 温度2)。"""
        ...

    def hotter_city_answer(self, c1, c2) -> str | re.Pattern:
        """答案方法：判定就绪，处理平局。"""
        winner, _, _ = self.hotter_city(c1, c2)
        if winner == "一样":
            return re.compile(r"一样|相同|差不多")
        return winner

# 任务的 get_answer() 变成一行
class CompareCityTemp(AnswerTask):
    def get_answer(self, input):
        return Weather(input.apps["weather"]).hotter_city_answer(
            self.p.city1, self.p.city2,
        )
```

**设计规则**：

1. 返回类型须对齐 `match_value` 语义（`int` / `float` / `str` / `re.Pattern` / `dict`）
2. **平局或同义词必须返回 `re.Pattern`**——绝不要硬编码字符串
3. `get_answer()` 要做的每个计算都应放在答案方法中——`get_answer()` 只是单次调用
4. **不做判定决策**——答案方法说"正确答案是什么"，不是"Agent 答对了吗"

### 2.4 检查方法（返回标准检查字典）

**所有与 schema 耦合的验证都必须封装为 `check_*` 方法**。`check_goals()` 只组合这些原子检查并处理任务特定的分支（条件逻辑、答案组装）。

```python
# task/wechat/app.py 中的真实方法
class Wechat(BaseApp):
    def check_new_sent_contains(
        self, contact_name: str, *keywords: str, field: str | None = None,
    ) -> dict[str, Any]:
        """验证新发送的消息（拼接后）包含每个关键词。"""
        if field is None:
            field = f"sent_to_{contact_name}"
        joined = self.joined_new_texts_to(contact_name)   # 复用数据方法
        passed = bool(joined) and all(kw in joined for kw in keywords)
        return {
            "field": field,
            "expected": f"new msgs to '{contact_name}' with {list(keywords)}",
            "actual": joined[:200] or "(none)",
            "passed": passed,
        }
```

**设计规则**：

1. **返回单个 `dict`**，不是 `list[dict]`——列表组装是 `check_goals()` 的事
2. **使用 `*keywords` / 命名参数而不是谓词 lambda**——调用点自文档化
3. **`field` 有语义默认值；调用方可以覆盖**——单次调用用默认值；当 `check_goals()` 多次调用同一方法时，传 `field=` 以区分（否则报告无法定位失败）
4. **方法名自文档化**——`wechat.check_new_sent_contains(contact, title)`，不要 `wechat.check(contact, title, mode="sent")`
5. **通过 `expected` 表达正/负状态**——`check_following(name, expected=False)` 表示"取关"；避免每个反向操作写一个方法

### 2.5 init 与 current，以及 CRUD 检查策略

`check_*` 方法的写法取决于**操作类型**。CRUD 操作各自只有一种正确的检查策略——这不是选择，而是推导。

| 操作 | 检查策略 | 为什么只有这种可行 |
|---|---|---|
| **Create** | **diff**：在 `current \ init` 中找匹配 | 不做 diff，你无法区分"Agent 添加的"与"本来就有的" |
| **Delete** | **diff**：目标 ID 在 `init \ current` 中 | 不做 diff，你无法区分"Agent 删除的"与"从未存在的" |
| **Modify** | **在 init 中定位，在 current 中验证** | 修改后内容已变；只有 init 能可靠定位目标 |
| **Query** | **读 init**：从 init 读取期望答案 | 答案在任务设置时就已固定；Agent 的行为不会改变它 |

#### Create

```python
class Clock(BaseApp):
    def check_created_alarm(self, h, m, **attrs) -> dict:
        # 采样器契约：目标在 init 中必须不存在
        assert self.init.find_alarm_by_time(h, m) is None
        # Agent 行为判定：在新添加的条目中找匹配
        match = next(
            (a for a in self.new_alarms()
             if int(a["hour"]) == h and int(a["minute"]) == m
             and all(str(a.get(k)) == str(v) for k, v in attrs.items())),
            None,
        )
        return {
            "field": "alarm_created",
            "expected": {"h": h, "m": m, **attrs},
            "actual": match,
            "passed": match is not None,
        }
```

#### Delete

为什么不直接对 current 做 `find_by_id(x) is None`？**如果采样器有 bug（目标从未存在）**，那个检查返回 None → `passed=True`——一个**假阳性**。diff 返回 `passed=False`（安全的假阴性），配合采样器契约 assert，bug 会变成 `judge_error`。

```python
def check_deleted_alarm(self, alarm_id) -> dict:
    assert self.init.find_alarm_by_id(alarm_id) is not None   # 采样器契约
    removed = self.removed_alarm_ids()   # init IDs - current IDs
    return {"field": "alarm_deleted", "expected": alarm_id,
            "actual": removed, "passed": str(alarm_id) in removed}
```

#### Modify

```python
def check_alarm_fields(self, hour, minute, **expected) -> dict:
    # 在 init 中定位
    init_alarm = self.init.find_alarm_by_time(hour, minute)
    assert init_alarm is not None   # 采样器契约
    alarm_id = init_alarm["id"]

    # 在 current 中验证
    alarm = self.find_alarm_by_id(alarm_id)
    if alarm is None:
        # Agent 删除了闹钟而非修改——这是合法的 Agent 失败
        return {"field": f"alarm_{alarm_id}", "expected": expected,
                "actual": None, "passed": False}
    passed = all(str(alarm.get(k)) == str(v) for k, v in expected.items())
    return {"field": f"alarm_{alarm_id}", "expected": expected,
            "actual": {k: alarm.get(k) for k in expected}, "passed": passed}
```

`alarm is None → passed=False` **不是**防卫式编码——它是对 Agent 行为的合法判定。如果你写 `alarm["hour"]` 让它抛异常，就会把 Agent 的失败误归为 `judge_error`。

#### Query

Query 不需要显式 assert——解引用 init 自然会抛 `TypeError`，这本身已经是 `judge_error`：

```python
def get_answer(self, input):
    # 闹钟不存在 → TypeError 传播 → judge_error ✓
    return Clock(input.apps_init["clock"]).find_alarm_by_id(self.p.alarm_id)["note"]
```

#### App 实例构造规则

```python
# Create / Delete / Modify：需要两个状态
clock = Clock(input.apps["clock"], init=input.apps_init["clock"])
clock.alarms              # current
clock.init.alarms         # init
clock.find_alarm_by_id(x)        # 在 current 中查找
clock.init.find_alarm_by_id(x)   # 在 init 中查找

# Query：只需要 init
clock = Clock(input.apps_init["clock"])
```

#### 采样器契约 assert 为什么存在

**assert 不是为了重新验证上游——它们的存在是为了保持归因正确。** 没有它们，采样器 bug 会被静默归咎于 Agent：

| 操作 | 采样器 bug | 没有 assert | 有 assert |
|---|---|---|---|
| Create | 目标已存在 | diff 为空 → `passed=False`（归咎 Agent） | `AssertionError` → `judge_error` ✓ |
| Delete | 目标不在 init 中 | 不在 removed 中 → `passed=False`（归咎 Agent） | `AssertionError` → `judge_error` ✓ |
| Modify | 目标不在 init 中 | 查找返回 None → `passed=False`（归咎 Agent） | `AssertionError` → `judge_error` ✓ |
| Query | 数据缺失 | 自然 TypeError → `judge_error` ✓ | 不需要 assert |

**把 assert 放在 App 的 `check_*` 方法中**，而不是任务的 `check_goals()` 中——任务代码保持一行调用。

#### 归因总结

| 场景 | 归因 | 机制 |
|---|---|---|
| Agent 什么都没做 / 做错了 | `passed=False` | CRUD 检查逻辑 |
| 采样器 bug（前置条件违反） | `judge_error` | check 方法内的 assert |
| App 数据结构损坏 | `judge_error` | property 层的类型检查 |
| Query init 数据缺失 | `judge_error` | 自然解引用 TypeError |
| 判定代码本身的 bug | `judge_error` | 框架级 try/except |

**铁律**：`passed=False` 只出现在 Agent 能影响的结果中。任何非 Agent 的失败必须走异常路径变成 `judge_error`。

### 2.6 组合 CRUD 检查

复杂任务通过组合相同的 CRUD 原语构建。让每个 App 辅助方法只负责一个原子判定，然后在 `check_goals()` 中组装任务级列表。

| 模式 | 示例 | 检查组合 |
|---|---|---|
| 混合创建 + 查询 | 添加城市，然后报告本地时间 | `[check_created_city(city), check_city_time_answer(city, os, answer)]` |
| 替换 | 删除城市 A 并添加城市 B | `[check_deleted_city(old), check_created_city(new)]` |
| 批量修改 | 启用所有闹钟 | 每个目标条目一个 modify 检查 |
| 条件分支 | 如果下雨，发带伞提醒；否则发晴天通知 | 从 init 读取条件，然后选择期望的消息检查 |
| 过程 + 结果 | 搜索，然后收藏目标结果 | `[check_created_search(keyword), check_created_favorite(item_id)]` |

```python
def check_goals(self, input):
    clock = Clock(input.apps["clock"], init=input.apps_init["clock"])
    return [
        clock.check_created_city(self.p.city),
        clock.check_city_time_answer(self.p.city, input.os, input.answer),
    ]
```

### 2.7 检查的可靠性要求

每个 `check_*` 方法和 `check_goals()` 必须满足：

1. **在错误路径上无误报**——通过必须证明目标达成；不能仅靠宽泛的关键词命中
2. **在合理路径上无漏报**——不是任务核心的变体（措辞、顺序、布局）不应导致失败
3. **证据是最终状态或稳定检查点**——优先验证最终产物；如果需要语义性的中间状态且它可稳定观测，可以纳入
4. **不要绑定到路径特定的步骤**——某个特定 UI 路径的偶然步骤不是唯一正确方式
5. **不要把不稳定痕迹字段当作硬证据**——`lastAccess` / `currentSelected` 等可被后续操作覆盖；它们不能单独决定通过/失败

**禁止**：

- 因为一个宽泛的词（"计划""总结""推荐"）而通过——除非该词是任务的核心目标
- 把原始标题 / 原文全文 / 固定措辞当作唯一正确形式（除非模板明确要求逐字转发）
- 强制依赖不可靠的中间状态字段；如果 App 没有可靠机制，就接受只有最终结果可验证

### 2.8 安装辅助方法（`prepare_state_with_*`）

App 类可以持有一小部分仅用于安装的辅助方法，封装与 schema 耦合的对象构造或状态变更。

**核心规则**：

1. **App 准备状态；任务把它写入 env**——辅助方法可以返回单个对象、新状态或补丁，但它**绝不能**接受 `env` 或调用 `env.get_state()` / `env.set_state()`；运行时编排属于任务
2. **暴露给任务的主入口使用 `prepare_state_with_*` 前缀**——含义是"给定当前状态，返回注入后的状态"
3. **单对象构造器可以是 `prepare_event(...)` / `prepare_message(...)`**——内部使用；任务应优先用 `prepare_state_with_*`
4. **命名描述结果，不是 env 操作**——禁止：`inject_*` / `mutate_*` / `set_*_in_env`

```python
# ✅ App 返回新状态；任务决定何时写回
class Calendar(BaseApp):
    @staticmethod
    def prepare_event(...) -> dict[str, Any]: ...

    def prepare_state_with_event(self, ...) -> dict[str, Any]:
        next_state = dict(self.raw)
        next_state["events"] = [*self.get_list("events"), self.prepare_event(...)]
        return next_state

class SomeTask(BaseTask):
    async def _prepare(self, env):
        state = await env.get_state()
        cal_state = Calendar(state["apps"]["calendar"]).prepare_state_with_event(...)
        await env.set_state({"apps": {"calendar": cal_state}}, deep=True, reload=False)
```

**适用场景**：标准日历事件 / 短信 / 微信聊天消息构造；向 app 状态追加记录；多任务共享同一注入 schema。

**不适用场景**：任务特定的注入策略；与 `_seed` / 采样分支紧密耦合的决策；跨 App 协调写入。

### 2.9 `task/utils.py`：跨套件工具

| 类别 | 示例 |
|---|---|
| 文本 | `clean_text()` / `norm()` / `extract_numbers()` |
| 时间 | `now_ms(os)` / `sim_today(os)` / `sim_datetime(os)` / `today_ymd(os)` |
| 解析 | `parse_distance_to_meters()` / `parse_duration_to_minutes()` |
| 日期匹配 | `date_match_labels(date, os)` ——见 §4.6 |
| 多候选组合器 | `check_alternatives(*check_arrays)` ——OR 语义 |

`check_alternatives(*check_arrays)` 将各数组中同索引的检查视为一个候选。它返回第一个每组检查全部通过的候选组；如果没有候选完全通过，则返回第一个候选组用于诊断。空数组或长度不匹配时会抛异常，因此只在每个数组代表相同候选集且顺序一致时使用。

**禁止**：在任务文件中局部定义共享工具；在 app.py 中内联通用解析逻辑。

### 2.10 快速决策表

| 问题 | 归属 |
|---|---|
| 数据在哪、怎么取、有哪些字段——且有结构复杂度 | App 数据方法 |
| 数据遍历 / 聚合 / 计算（即使只一个任务使用） | App 数据方法（通用名称） |
| 派生判定就绪的答案（比较、排序、格式化、平局正则） | App 答案方法 |
| 与 schema 耦合的验证（无论复用次数） | App 检查方法（**强制**） |
| 与 schema 耦合的安装对象构造 / 状态变更 | App `prepare_state_with_*` 辅助方法 |
| 任务特定的条件分支（基于事实决定验证什么） | `check_goals()` 中内联 |
| 路径本身就表达了语义；无结构复杂度 | 不封装；使用 `app.get()` |
| 跨套件工具 | `task/utils.py` |

---

## 3. 第三步：选择 `tasks.py` 还是 `defs/<TaskName>.py`

任务类可以放在旧式单文件布局 `tasks.py` 或一任务一文件布局 `defs/<TaskName>.py` 中。两者可以在同一套件中共存，但类名必须唯一。

### 3.1 决策矩阵

| 任务特征 | 放在 `tasks.py` | 放在 `defs/<Name>.py` |
|---|:---:|:---:|
| 同一参数化任务的多个变体（同基类、共享元数据） | ✓ | |
| 简单声明式任务（`criteria = {...}` / `answer = ".path"` 只需1-2行） | ✓ | |
| 大批量（套件有30+个任务） | | ✓ |
| 单个任务 ≥ 50行 / 有 `_prepare` + 自定义 `check_goals` | | ✓ |
| 任务有独立判定逻辑或长 docstring | | ✓ |
| 跨 App 任务（每个场景独立） | | ✓ |
| 一个类配一组紧密相关的变体 | ✓（放在一起） | |

**新任务优先用 `defs/`**——单文件更容易 grep、diff、移动、删除。

### 3.2 现有套件布局

```
task/wechat/         tasks.py        — 多个参数化设置任务
task/redbook/        tasks.py        — 简单浏览/点赞任务
task/railway12306/   tasks.py        — 18个任务，参数化购票

task/launcher/       defs/           — 一文件一任务
task/calendar/       defs/           — 同上
task/map/            defs/           — 同上
task/crossapp_life/  defs/           — 跨 App，每个场景独立
task/crossapp_work/  defs/           — 同上
```

### 3.3 何时迁移

当以下任一条件成立时，将类从 `tasks.py` 迁移到 `defs/<Name>.py`：

- 类长度 ≥ 50行或 `check_goals` 有超过两层缩进
- 单任务 docstring > 5行
- 类添加了任务特有的常量、采样器函数或自定义安装

保持类名不变；文件名应匹配主类（`SendVerificationCodeToContact.py`）。不需要在 `tasks.py` 中留仅导入的存根。

---

## 4. 第四步：编写任务类

### 4.1 基类决策树

```
任务目标是什么？
├── Agent 必须回答信息 → AnswerTask (objective=query)
│   ├── 答案可用类变量表达 → 定义 `answer`
│   └── 答案需要复杂计算 → 重写 `get_answer()`
│
├── Agent 必须变更状态，可通过 key=value 判定 → CriteriaTask (objective=operate)
│   ├── 所有条件是静态的 → `criteria` 类变量
│   ├── 条件需要参数化 → `criteria` 带有 "{param}" 模板
│   └── 还需要答案检查 → 加 `answer` 类变量 (objective=hybrid)
│
├── Agent 必须变更状态，判定需要前后 diff → BaseTask
│   └── 重写 `check_goals()`（不要重写 `is_successful`）
│
└── 目标需要自定义前后推理 → BaseTask
    └── 重写 `check_goals()` 并将任务特定逻辑保留在那里
```

**硬性规则**：如果 `CriteriaTask` / `AnswerTask` 能用，**不要**子类化 `BaseTask` 手写 `check_goals`。

### 4.2 声明式优先

编写任务时，按此顺序决定——越早越好：

1. **先试声明式**——`answer = ".path"` / `criteria = {"key": "value"}`。检查路径表达式能否直接表达目标。
2. **考虑扩展框架**——如果声明式只差一点点（例如需要新的 dict-of-paths 或 criteria 模板语法），扩展框架让所有任务受益。
3. **仅在必要时写 `get_answer()` / `check_goals()`**——逻辑确实无法声明时才写。

**审视 app.py 方法**：

- 一个方法只是 `self.get("fieldA.fieldB")` 的透传 → 去掉它；用声明式路径
- 一个方法只是 `next(x for x in self.list if x["key"] == value)` → 去掉它；用 `[key={param}]` 语法
- 只有**真正复杂的数据访问**（多步查找、模糊匹配、跨集合 join、格式兼容性）才值得 app.py 方法

```python
# ❌ 过度封装：app.py 方法 + tasks.py 调用链
def get_default_passenger(self) -> dict:
    for p in self.passengers:
        if p.get("isDefault"): return p
    return None

answer = staticmethod(lambda task, state: Railway12306(state).get_default_passenger()["name"])

# ✅ 一行声明式
answer = ".passengers[isDefault=True].name"
```

### 4.3 CriteriaTask 用法

**`criteria` 必须是类变量**（不要写 `@property def criteria`）。

```python
# 静态
class OpenWallet(CriteriaTask):
    criteria = {"route": "/me/wallet"}

# 参数化："{param}" 模板，不用 @property
class SetNickname(CriteriaTask):
    parameters = {"name": {"type": "string", "default": "test"}}
    criteria = {"user.profile.nickname": "{name}"}

# 数组查找：[field={param}] 语法
class BlacklistContact(CriteriaTask):
    criteria = {"contacts[name={contact}].isBlacklisted": True}

# 跨 App：appName: 前缀
class ShareToWechat(CriteriaTask):
    apps = ["redbook", "wechat"]
    criteria = {
        "route": "/search",   # route 总是指前台 App
        "wechat:chats.{contact_wxid}.messages[-1].type": "share",
    }

# 混合：criteria + answer
class SearchAndCount(CriteriaTask):
    objective = "hybrid"
    criteria = {"route": "/search", "search.current.query": "{query}"}
    answer = ".search.totalResults"

# 自定义谓词（criteria 值为 lambda）
class CheckSignatureLength(CriteriaTask):
    criteria = {"user.profile.signature": lambda sig: len(sig or "") > 10}

# 缺失值：用于"字段/条目不应存在"的检查
class DeleteDraft(CriteriaTask):
    criteria = {"drafts[id={draft_id}]": None}
```

**值映射**使用 `values` 字典（`{显示值: 内部值}`）；**不要**使用 `_XXX_MAP`：

```python
class SetFontSizeLevel(CriteriaTask):
    parameters = {
        "font_size": {
            "type": "enum",
            "values": {"最小": 0, "较小": 1, "标准": 2, "较大": 3, "最大": 4},
            "default": 2,
        },
    }
    criteria = {"settings.general.fontSizeLevel": "{font_size}"}
```

**参数语义必须与 store 匹配**——不要取反或运行时计算（例如 `not self.p.share_off`）。

如果你子类化 `CriteriaTask` 并重写 `check_goals()`，除非你刻意要替换所有 `criteria` / `answer` 行为，否则用 `checks = super().check_goals(input)` 保留继承的检查。如果一个任务不再由 `criteria` 驱动，用 `BaseTask` 而不是写一个几乎为空的 `CriteriaTask`。

完整路径语法（`[field=value]` / `[+N]` / `[+=val]` / `._order`）参见 [`../REFERENCE.md`](../REFERENCE.md)。

### 4.4 AnswerTask 用法

**优先使用 `answer` 类变量**，按偏好顺序：

```python
# 路径表达式
class CheckBalance(AnswerTask):
    answer = ".balance.totalAmount"

# 路径 + 转换
class CountContacts(AnswerTask):
    answer = (".contacts", len)

# 参数过滤
class FindFriend(AnswerTask):
    answer = ".contacts[name={name}].phone"

# 布尔字面量过滤
class DefaultPassengerName(AnswerTask):
    answer = ".passengers[isDefault=True].name"

# 跨 App
class CheckRedbookLikes(AnswerTask):
    answer = "redbook:.posts[0].likes"

# dict-of-paths：独立槽位匹配
class CheckStudentVerify(AnswerTask):
    answer = {"from": ".studentVerify.from", "to": ".studentVerify.to"}

# callable —— 接收完整 apps_init 字典，按 app 名索引
class ContactCount(AnswerTask):
    apps = ["wechat"]
    answer = staticmethod(lambda task, apps_init: len(apps_init["wechat"]["contacts"]))

# 字面量
class CountTabs(AnswerTask):
    answer = 4
```

> **状态来源**：上面每种声明式 `answer` 形式（路径 / 元组 / dict / callable）都从 `input.apps_init` 读取——即任务设置时捕获的初始状态，符合纯查询语义（"真值在你开始时就已固定"）。如果答案取决于 Agent 操作后的状态（混合的查询-操作后任务），重写 `get_answer()` 并显式读取 `input.apps`。

**何时重写 `get_answer()`**：

1. 计算跨多个字段（求和 / 比较 / 排序）
2. 先过滤再聚合
3. 路径语法无法表达的逻辑
4. 答案必须来自最终/操作后状态，或需要跨 App / `os_init` 访问

```python
class MonthlyExpenseTotal(AnswerTask):
    def get_answer(self, input):
        return Alipay(input.apps_init["alipay"]).monthly_expense(self.p.month)
```

**`get_answer()` 返回类型与 `match_value` 语义**：

| 类型 | 匹配方式 | 示例 |
|---|---|---|
| `int` / `float` | 从 Agent 回复中提取数字并比较（带中文数字归一化） | `23` 匹配"有23个人"、"二十三" |
| `str` | Agent 回复包含该字符串 | `"张三"` 匹配"用户名是张三" |
| `re.Pattern` | 正则 `search` | `re.compile(r"一样|相同|差不多")` |
| `dict` | 逐槽匹配（每个槽独立） | `{"price": 99, "shipping": "free"}` |

> **`bool` 类型**不会自动走 `match_value`——见 §4.5 布尔查询处理。

**平局 / 同义词必须使用 `re.Pattern`**——Agent 可能用多种方式表达同一意思（"一样热" / "差不多" / "温度相同"）。硬编码字符串只做子串包含，无法覆盖所有变体。

**不要通过 `input.answer` 验证非答案内容**：`input.answer` 是 Agent 的自然语言回复。检查"Agent 是否发送了消息"应检查 App 状态，不是 `input.answer`。

### 4.5 布尔查询处理

当查询任务的答案为布尔值时（如"验证是否通过？"），**不要**用 `match_value` 或 `answer` 类变量。原因：肯定词是否定词的子串（"通过" ⊂ "未通过"，"success" ⊂ "unsuccessful"），所以 `re.search(r"通过")` 会错误匹配"未通过"。

**正确做法**：在 `check_goals()` 中，**先检测否定，再检测肯定**：

```python
def check_goals(self, input):
    expected = input.apps["railway12306"]["user"]["realNameVerified"]
    answer = re.sub(r"\s+", "", str(input.answer or ""))
    negative = re.search(r"未通过|没有通过|没通过|未成功|没成功|不成功|失败", answer)
    positive = re.search(r"成功|通过|已核验", answer)
    judged = False if negative else True if positive else None
    return [{
        "field": "answer",
        "expected": "affirmative" if expected else "negative",
        "actual": input.answer,
        "passed": judged is not None and judged == expected,
    }]
```

**规则**：

1. 否定检测必须在肯定检测之前
2. 根据问题语境构建否定词列表（"通过了吗？" → "未通过/没通过"；"成功了吗？" → "未成功/不成功/失败"）
3. **中英文都有子串歧义**——"success" ⊂ "unsuccessful"，"pass" ⊂ "not passed"。英文同理：先搜否定（`unsuccessful|not passed|failed`），再搜肯定
4. **不要把预设数据放入 `criteria`**——`criteria` 只检查 Agent 引起的状态变更

### 4.6 日期和时间匹配

**日期答案**：使用 `date_match_labels(date, os_state)` 生成多个标签并做包含匹配。

```python
from bench_env.task.utils import date_match_labels

labels = date_match_labels(answer["date"], input.os)
passed = any(label in answer_text for label in labels)
```

覆盖：`2026-03-19` / `3月19日` / `3月19号` / `19日` / `19号` / `周三` / `星期三` / `明天` / `后天` / `大后天` 等。

**必须传 `os_state`**——没有它，相对日期标签无法生成，而 Agent 很可能用"明天" / "后天"作答。

**时间 / 时长**：`match_value` 的子串包含无法处理等价格式变体（`"09:54"` vs `"上午9点54分"`，`"0小时59分"` vs `"59分钟"`）。使用框架的语义匹配器：

| 匹配器 | 用途 | 容差 |
|---|---|---|
| `match_time(expected, actual)` | 一天中的时间（`"HH:MM"`） | **±5 分钟**（覆盖 Agent 读屏幕与框架快照之间的漂移） |
| `match_duration(expected, actual)` | 时长（`"X小时Y分"`） | 严格 |

```python
from bench_env.task.common_tasks import match_value, match_duration, match_time

def check_goals(self, input):
    answer = str(input.answer or "")
    train = self.app.fastest_train(...)
    fields = [
        ("车次",   "trainNo",     match_value),
        ("历时",   "duration",    match_duration),
        ("到达时间", "arriveTime", match_time),
    ]
    return [
        {"field": f"answer.{name}", "expected": train[key],
         "actual": answer, "passed": matcher(train[key], answer)}
        for name, key, matcher in fields
    ]
```

**选择规则**：

| 字段类型 | 匹配器 |
|---|---|
| 纯文本（名称、站名、车次号） | `match_value` |
| 数字（金额、计数） | `match_value`（内置数值提取） |
| 时间 `"HH:MM"` | **`match_time`** |
| 时长 `"X小时Y分"` | **`match_duration`** |
| 日期 | `date_match_labels` |
| 其他结构化等价形式 | 在 `common_tasks.py` 中添加匹配器 |

### 4.7 编写 `check_goals`

`check_goals()` 的工作是**组合 `check_*` 调用 + 处理任务特定分支**。每个检查字典代表**一个目标是否达成**。

**铁律**：

1. **每个检查必须有 `passed`**——框架缺失时会抛 `ValueError`
2. **`expected` / `actual` 必须可诊断**——`expected=True, actual=None` 无法定位失败；使用人类可读的"期望什么"和"实际发生什么"摘要
3. **只检查 Agent 行为**——不要检查环境前置条件（"最新订单存在吗？"）或 Agent 无法控制的事（"直达车数量 > 0"）
4. **`operate` 任务只检查最终状态**——顺序/数据存在和正确性就是标准；不要检查中间过程。**例外**：当任务目标本身就是"导航到某页面"时，路由就是最终结果
5. **`check_goals()` 组装列表**——验证什么是它的决策；App `check_*` 只返回单个 dict
6. **通用模式用 App `check_*`**——一般性验证（"发送了消息"、"最新笔记包含"）封装在 App 类中；`check_goals()` 调一次
7. **任务特定逻辑保持内联**——分支、跨实体关联、复杂的 init diff 直接写在 `check_goals()` 中，不强制抽象
8. **覆盖模板的隐式约束**——模板中的隐式条件应被检查。"发朋友圈"隐含只发纯文本（不带图）；判定必须同时检查内容匹配和图片附件缺失

#### 一个检查 = 一个目标

每个检查字典是**一个目标**，不是一个字段。"买了正确的票"是一个目标——**不要**拆成路线 / 日期 / 车次 / 座位 / 乘客作为单独检查。拆分会虚增 `progress`（买错了日期的票报告80%进度）并违背"检查"的语义。

```python
# ❌ 拆成字段级检查：虚增 progress
return [
    {"field": "order.exists",     "expected": True,    "actual": order, ...},
    {"field": "order.trainNo",    "expected": "G7002", "actual": order["trainNo"] if order else None, ...},
    {"field": "order.ticketCount","expected": 1,       "actual": len(order["tickets"]) if order else None, ...},
]
# 日志：当 order 为 None 时，每个 actual=None——毫无诊断价值

# ✅ 一个目标 = 一个检查；可读摘要
return [rail.check_booking_order(
    from_station="上海", to_station="南京", date="2026-03-21",
    passenger_names=["赵宇轩"], expected_train_no="G7002", seat_type="二等",
)]
# 日志：[✗] newPendingOrder:
#   expected=上海→南京 2026-03-21 G7002 二等 ×1 (赵宇轩),
#   actual=上海→南京 2026-03-20 G7002 二等 ×1 (赵宇轩)
```

**多个独立目标可以有多个检查**——例如"添加乘客 + 买票"是两个独立目标。检验标准：如果其中一个可以失败而另一个可以独立成功，它们就是分开的目标。

#### 真依赖 vs 假依赖

在考虑提前返回之前，确认后续检查**真的依赖**前序结果。如果它们仍可自然评估并返回 `passed=False`，那就不是真依赖——让所有检查一起运行；不要引入人为分支。

```python
# ❌ meeting 为 None 不影响后续检查，却人为提前返回
def check_goals(self, input):
    meeting = tm.new_scheduled_meeting_by_title(topic)
    if meeting is None:
        return [tm.check_new_scheduled_title_matches(topic)]
    return [tm_chk, cal_chk, alarm_chk, wx_chk, sms_chk]

# ✅ 后续检查不依赖 meeting；全部返回
def check_goals(self, input):
    meeting = tm.new_scheduled_meeting_by_title(topic)
    mid = re.sub(r"\s+", "", str(meeting["meetingId"])) if meeting else ""
    return [
        tm.check_new_scheduled_start_time(topic, target_ms, ...),
        cal.check_event_start_reminder_alarm(topic, target_ms, ...),
        wechat.check_new_sent_meeting_id(contact, mid, ...),
    ]
```

#### 当依赖为真时，保持列表长度稳定

当先序检查确实影响后续检查时，**不要只提前返回先序检查**——为后续检查添加 `passed=False` 占位符，让返回列表长度不依赖执行路径：

```python
# ✅ 始终返回固定长度
def check_goals(self, input):
    sc = m.check_searched(category=None)
    if not sc["passed"]:
        return [sc, {"field": "answer", "passed": False,
                     "expected": "评分答案", "actual": "未执行搜索"}]
    return [sc, m.check_place_rating_answer(...)]
```

**为什么**：`progress = passed_count / len(checks)`。稳定长度让总检查次数在各次运行中可比，并在日志中显示哪些检查被跳过了。

### 4.8 声明 `expected_changes`

`expected_changes` 声明**任务预期产生的状态变更**。任何未声明的变更会被记录为 `warnings` 条目并强制 `clean=False`。

#### 如何编写

| 任务类型 | 形式 | 框架展开为 |
|---|---|---|
| 单 App（`apps=["wechat"]`） | `"history"` | `apps.wechat.history` |
| 多 App | `"redbook.history"` | `apps.redbook.history` |
| 已有前缀 | `"apps.xxx"` / `"os.xxx"` | 不变 |

#### CriteriaTask 自动推导

`CriteriaTask` 从 `criteria` 键（排除 `route`）自动推导 `expected_changes`，因此**通常不需要手动声明**。

**例外**：当 criteria 使用索引路径（`moments[0].content`）检查新增元素时，你必须声明 `expected_changes = ["moments[+1]"]`——新元素的 diff 路径是 ID 路径（`moments[id=xxx]`），索引路径推导的期望无法覆盖它。

#### AnswerTask 通常不需要

纯查询任务不改变状态。但如果查询产生副作用（搜索历史等），需要声明。

#### 精确路径语法

简单的"宽路径"（如 `"alarms"`）允许对整个列表任意变更。更严格的声明使用精确路径——完整语法见 [`../REFERENCE.md`](../REFERENCE.md) §10。最常用形式：

| 形式 | 含义 |
|---|---|
| `"contacts[name={contact}].isBlacklisted"` | 按可读字段过滤目标元素 |
| `"moments[+1]"` | 允许添加1个条目 |
| `"selectedCityIds[+={city_id}]"` | 原始数组 set-add |
| `"tags._order"` | 顺序变更 |

#### 常量放在 app.py

`expected_changes` 路径描述的是"操作此 App 时哪些状态路径会变化"——schema 知识。**定义在对应的 `app.py` 中**：

```python
# wechat/app.py
WECHAT_SEND_CHANGES = ["wechat.chats"]
WECHAT_MOMENT_CHANGES = ["wechat.moments"]

# 跨 App tasks.py 组合它们
from bench_env.task.wechat.app import WECHAT_SEND_CHANGES
from bench_env.task.notes.app import NOTES_CREATE_CHANGES

class ShareToWechatAndNotes(BaseTask):
    expected_changes = WECHAT_SEND_CHANGES + NOTES_CREATE_CHANGES
```

#### 覆盖每个副作用

Agent 操作经常产生容易遗漏的副作用。**在 UI 中运行一次任务，diff 前后状态，把每个变更的路径都加上**。

常被遗漏的：

| 操作 | 易漏字段 |
|---|---|
| 查看消息 | `conversations.lastReadAt` |
| 转账 / 支付 | `transferDraft` / `transferReceipt` / `lastPaymentHint` |
| 搜索 | `searchHistory` / `billSearchHistory` |
| 收藏 / 点赞 | `favoriteIds` / `likedIds` |

### 4.9 元数据

每个任务必须声明四个轴 + 能力标签：

```python
class MyTask(CriteriaTask):
    scope = "S1"              # S1（单App）/ S2（两App）/ S3（3+）；从 len(apps) 推导
    objective = "operate"     # operate / query / hybrid
    composition = "atomic"    # atomic / sequential / transfer / deep_dive
    difficulty = "L2"         # L1 / L2 / L3 / L4
    max_steps = 30            # 可选：15 / 30 / 45 / 60
    capabilities = ["nav", "settings"]   # 1–4 项；只写核心能力
```

**难度校准**：

| 等级 | 黄金步数 | 典型场景 |
|---|---|---|
| L1 | 1–4 步 | 单次导航、简单开关 |
| L2 | 5–10 步 | 搜索 + 操作、多步导航 |
| L3 | 11–20 步 | 复杂过滤、跨页操作 |
| L4 | 20+ 步 | 多 App 组合、多步推理 |

如果省略 `max_steps`，运行器对所有难度等级统一使用 `30` 步默认预算。仅在任务的交互预算需要显式例外时才添加 `max_steps`；有效的任务级值只能是 `15`、`30`、`45` 或 `60`。在接地模式中，带有 `answer_fields` 的任务仍额外获得 +15 步用于解耦的答题卡流程。

**能力标签**：

| 标签 | 含义 |
|---|---|
| `nav` | 导航到目标页面 |
| `settings` | 修改设置 |
| `search` | 搜索与过滤 |
| `create` / `edit` / `delete` | 创建 / 修改 / 删除 |
| `social` | 社交互动（点赞 / 关注 / 评论） |
| `extract` | 信息提取 |
| `handoff` | 跨 App 信息传递 |
| `finance` | 金融操作 |
| `reasoning` | 认知推理（比较、计算） |
| `explore` | GUI 探索 |
| `image` | 非 UI 图像/照片理解 |

**标注规则**：只标核心能力；不要标注必要的前置步骤如导航。`extract` 是能力（任务过程中提取信息）；`objective=query` 是目标（Agent 必须回答）。`handoff` 是能力（跨 App 传递信息）；`composition=transfer` 是组合类型（一步的输出喂给下一步）。

**`optimal_paths`**：声明最优路径解（来自 `navigation.declaration.ts` 的 transition / action ID 序列）：

```python
class ReadMyWxid(AnswerTask):
    optimal_paths = [["tab.me", "me.profile"]]
```

- 外层列表：备选最优路径
- 内层列表：有序步骤 ID；每个步骤是字符串或 `{"id": "...", "params": {...}}`
- 纯查询任务通常有 optimal_paths；复杂 operate 任务可以省略

### 4.10 合并 vs 拆分

当多个任务测试相似的交互模式时，决定是合并为参数化类还是拆分为独立类。

**合并条件（全部满足）**：

1. **参数正交**——每个参数的合法值相互独立；任意组合都合法
2. **交互模式相同**——Agent 的 UI 操作相同（只是读写字段不同）
3. **判定逻辑形状相同**——`get_answer()` / `check_goals()` 只在用哪个字段上分支

```python
# ✅ 好的合并：5个详情卡查询；参数正交，交互相同
class CheckDetailCard(AnswerTask):
    parameters = {
        "city":   {"type": "enum", "values": _SAVED_CITIES},
        "metric": {"type": "enum",
                   "values": {"湿度多少": "humidity", "紫外线强不强": "uv", "日出几点": "sunrise"}},
    }
```

**拆分条件（任一即可）**：

1. **参数耦合**——参数 A 的合法值取决于参数 B
2. **交互模式不同**——Agent 的 UI 流程不同
3. **拆分后每个类 < 15行**——简单到不需要合并

```python
# ❌ 强行合并：温度只有2个合法值，风速有5个 → 需要采样器 + 辅助字典，约40行
# ✅ 拆分：每个约10行
class SwitchTempUnit(CriteriaTask):
    parameters = {"unit": {"type": "enum",
                           "values": {"摄氏度": "celsius", "华氏度": "fahrenheit"}}}
    criteria = {"settings.tempUnit": "{unit}"}

class SwitchWindUnit(CriteriaTask):
    parameters = {"unit": {"type": "enum",
                           "values": {"蒲福": "beaufort", "公里/小时": "kmh", ...}}}
    criteria = {"settings.windUnit": "{unit}"}
```

**决策捷径**：

| 条件 | 行动 |
|---|---|
| 参数任意组合都合法 + 交互相同 | 合并 |
| 合法组合是笛卡尔积的真子集 | 拆分 |
| 不同变体有不同的 Agent UI 流程 | 拆分 |
| 拆分后每个类 < 15行 | 拆分 |

---

## 5. 第五步：参数与采样

### 5.1 数据来源偏好

bench_env 获取 App 数据的优先级：**`getState()` 运行时状态 > app 离线数据文件 > 硬编码常量**。

**参数声明偏好**（编写任务时按此顺序）：**`source` > `sampler` > 硬编码 `enum`**——能用 `source` 从 env 状态采样时优先使用；仅在需要过滤/约束时升级到 `sampler`；值域与 env 数据无关时才用 `enum`。

> **注意**：这是设计偏好，不是框架的执行顺序。框架执行顺序为 `sampler` > `fields+source` > `source` > `type` > `default`；参见 [`../FRAMEWORK.md`](../FRAMEWORK.md) §4。

```python
# ✅ source：从 env 采样，与 defaults 同步
"contact": {"type": "string", "source": "apps.wechat.contacts[name]", "default": "张伟"}

# ✅ sampler：需要过滤/约束时
"contact": {"type": "string", "sampler": Wechat.sample_friend_name, "default": "张伟"}

# ✅ 硬编码 enum：值域与 env 数据无关时没问题
"range": {"type": "enum", "values": {"最近半年": "half_year", "最近一个月": "month"}}

# ❌ 硬编码 enum 容易与 env 数据偏离
"contact": {"type": "enum", "values": ["刘浪", "黄勇"]}
```

如果参数只有一个有意义的值，不要声明 `source` 或 `sampler`；用 `default`。如果 `source` 路径没有返回值会 fallback 到 `default` 并发出警告，所以拼写错误可能静默消除采样多样性——除非你检查警告。

**添加常量之前，先看 `getState()` 已经暴露了什么**。如果数据已在状态中，**绝不要**把它复制到 Python 模块级常量——副本会偏离源。

### 5.2 何时用 `sampler` 而不是 `source`

| 场景 | 方法 |
|---|---|
| 从列表随机取一个，无过滤 | `source` |
| 需要过滤（排除自己、排除黑名单） | `sampler`（App 的 `@staticmethod`） |
| 需要多个不同值 | `sampler` + `fields`，用 `rng.sample()` |
| 需要关联约束（出发/到达站必须构成路线） | `sampler` + 自定义逻辑 |

需要变化的数值参数必须声明 `min`/`max`、`values`、`source` 或 `sampler`。否则框架没有有用的值域来采样，实际上只会跑默认值。

### 5.3 `fields` 用于从一个 source 采样多字段

```python
parameters = {
    "contact": {
        "source": "apps.wechat.contacts",
        "fields": {
            "contact_name": "name",
            "contact_wxid": "wxid",
        },
    },
}
```

原始键 `"contact"` **不会**进入 `params`；只有 `fields` 下定义的键才暴露。

### 5.4 `sampler` + `fields` 用于协调多参数采样

当多个参数有关联关系（如出发站 + 到达站必须构成有效路线）时，使用 `_` 前缀的虚拟参数：

```python
parameters = {
    "_route": {
        "sampler": Railway12306.sample_route_pair,
        "fields": {"from_station": "from_station", "to_station": "to_station"},
    },
    "from_station": {"type": "string", "default": "上海", "description": "出发站"},
    "to_station":   {"type": "string", "default": "南京", "description": "到达站"},
}
```

约定：

- 虚拟参数键**必须以 `_` 开头**（`_route` / `_identity` / `_passengers`）
- 虚拟参数没有 `default`，不出现在 `self.params` 中，不会出现在模板里
- `sampler` 返回一个 dict（键匹配目标参数名）；`fields` 触发 `params.update()`
- 目标参数声明自己的 `default` 和 `description` 作为 fallback
- **顺序无关**：`_xxx` 可以在目标参数之前或之后（`TaskSampler` 在 `default` 分支中检查键存在性，所以默认值不会覆盖采样值）。推荐：把 `_xxx` 放在目标参数前面——读起来像"声明捆绑，再列字段"。

### 5.5 采样器放哪里

| 类型 | 位置 | 示例 |
|---|---|---|
| App 私有采样器 | `app.py` App 类 `@staticmethod` | `Railway12306.sample_route_pair` |
| App 私有采样器数据 | `app.py` 模块级常量 | `HOT_ROUTE_CHOICES`、`NEW_PASSENGER_PROFILES` |
| 通用采样器 | `utils.py` 模块级函数 | `sample_future_date(env_state, rng)` |
| 可调用 `default` | `utils.py` 模块级函数 | `default_tomorrow()` |

签名：

- `sampler`：`fn(env_state, rng) -> Any`
- 可调用 `default`：`fn() -> Any`（在 `__init__` 中求值）
- `display`：`fn(value) -> str` 或 `fn(value, env_state) -> str`

### 5.6 `_prepare` 和 `_post_sample` 时机

任务安装生命周期：

```
reset → warm → _prepare → get_state → sample → _post_sample → get_observation
                ↑                        ↑          ↑
                种子数据                 采样       按参数调整状态
```

**`_prepare(env)`** ——在采样**之前**运行：

- 配置初始 env 数据或为采样器置入数据
- **不能使用参数值**——`self.p.xxx` 在此时还是默认值
- 优先调用对应 App 的 `prepare_state_with_*` 辅助方法

```python
# 真实示例：task/wechat/app.py 提供 prepare_state_with_contact()
async def _prepare(self, env):
    state = await env.get_state()
    wechat = Wechat(state["apps"]["wechat"])
    if not wechat.find_contact("测试好友"):
        new_state = wechat.prepare_state_with_contact(
            name="测试好友", wxid="test_001",
        )
        await env.set_state({"apps": {"wechat": new_state}}, deep=True, reload=False)
```

**慎用 `_prepare`**：

1. 优先用 `defaults.json` 中已有的数据
2. 如果默认数据不适合任务，**停下来提出问题**——修改 `defaults.json`——不要在 `_prepare()` 中静默覆盖硬编码数据
3. 当注入确实必要时，把与 schema 耦合的构造下推到对应 `app.py` 的 `prepare_state_with_*` 辅助方法中

**`_post_sample(env)`** ——在采样**之后**运行：

- `self.p.xxx` 持有最终采样值
- 用于根据目标参数调整初始状态（如把设置设为相反值）

**`CriteriaTask._invert_criteria(env)` 辅助方法**：

```python
class ToggleDarkMode(CriteriaTask):
    parameters = {"toggle": {"type": "bool", "values": {"开启": True, "关闭": False}}}
    criteria = {"settings.general.darkMode": "{toggle}"}

    async def _post_sample(self, env):
        await self._invert_criteria(env)   # bool：翻转；enum：轮转到不同值
```

**`_invert_criteria` 只遍历 `criteria` 中声明的字段**，翻转每个字段的目标值并写入初始状态。`criteria` 之外的字段不受影响；采样参数值本身不会被修改。

它会跳过 `route`、可调用 criteria、以及任何解析路径中包含 `[` 的（数组索引或 `[field=value]` 过滤器）。当目标可变且状态路径是数组/过滤路径时，写自定义 `_post_sample()` 补丁而不是依赖 `_invert_criteria`。

**你需要 `_invert_criteria` 吗？**

| 场景 | 需要？ |
|---|---|
| 目标可变（开关 / 枚举参数） | **是**——采样值可能等于初始值 |
| 目标固定，但等于默认值 | **是**——Agent 不操作就能通过 |
| 目标固定，默认值已经是反值 | 否 |

---

## 6. 接地评估模式

当任务需要 Agent 提交结构化表单答案时（以消除模糊自然语言匹配的假阳性），声明 `answer_fields`。

**最小用法**：

```python
class CountAlarms(AnswerTask):
    answer = (".alarms", len)
    answer_fields = [{"type": "number", "label": "闹钟数量"}]
```

完整规则、Path A/B 决策和 `get_expected_response` 重写场景：[`GROUNDED_MODE.md`](GROUNDED_MODE.md)。

---

## 编写完成后

- 运行测试（`pytest bench_env/tests/test_<suite>.py -m "not live" -v`）——见 [`TASK_TESTING_GUIDE.md`](TASK_TESTING_GUIDE.md)
- 走一遍 [`TASK_CODE_SPEC.md`](TASK_CODE_SPEC.md) 中的最终清单
