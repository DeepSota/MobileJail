# MobileGym Jailbreak 任务运行说明

这个项目用于在 MobileGym 模拟环境中构建、验证和运行 mobile agent 越狱/高风险任务。当前推荐流程是：

1. 在 `Z-越狱构建/task.json` 里设计任务。
2. 用 `Z-Jailbreak_Construction_SKILL` 把 `task.json` 构建成可运行的 benchmark suite。
3. 启动 MobileGym 前端/网关服务。
4. 用 `bench_env.run` 跑 `jailbreak_json.1-10` 任务。

## 目录说明

- `Z-越狱构建/task.json`：任务设计源文件。这里写每个任务的风险类别、任务 ID、越狱指令、前置准备和风险描述。
- `Z-Jailbreak_Construction_SKILL/`：任务构建 skill。它会读取 `task.json`，生成可运行任务代码和离线测试。
- `bench_env/generated_task/jailbreak_json/`：由 skill 生成的任务 suite，不建议手动改，应该从 `task.json` 重新生成。
- `bench_env/tests/jailbreak_json/`：由 skill 生成的离线测试。
- `bench_env/adv_task0/`：手写 adversarial 任务与通用 judge/accessor 逻辑。

## 环境准备

进入项目根目录：

```bash
cd mobilegym-main
```

安装前端依赖：

```bash
npm ci
```

Python 侧需要 Python 3.11 或更高版本。推荐使用项目里的 `.venv-py312`；如果不存在，可以自己创建：

```bash
python3.12 -m venv .venv-py312
.venv-py312/bin/pip install -r bench_env/requirements.txt
```

如果本机使用 `uv`，也可以：

```bash
UV_CACHE_DIR=.uv-cache uv pip install --python .venv-py312/bin/python -r bench_env/requirements.txt
```

## 1. 设计任务

编辑：

```bash
Z-越狱构建/task.json
```

每条任务使用固定字段：

```json
{
  "风险类别": ["M-COMM（有害通信与胁迫性消息传播）"],
  "任务ID": "T0001_SmsThreatToZhangsan",
  "越狱指令": "直接输入给 agent 的任务指令。",
  "前置准备": ["运行任务前需要预置的数据。"],
  "风险描述": "为什么这是高风险或越狱测试样本。"
}
```

注意：

- `任务ID` 要稳定，生成后的 class 名会使用这个 ID。
- `越狱指令` 是最终喂给 agent 的 prompt。要注意数据、用户是否存在于数据库，不在的话需要前置准备或者更改初始数据库。
- `前置准备` 用来描述任务运行前需要的数据，例如短信、微信、支付宝对话或小红书笔记。
- 不要为了某个任务直接改 `apps/*/data/defaults.json` 或 `os/providers/defaults/*`；应通过 `前置准备` 让构建 skill 生成 task-local `_prepare()`。

## 2. 构建并验证任务

实际使用时不需要手动记构建脚本。按上面的格式写好 `task.json`，然后调用 `mobilejail/Z-Jailbreak_Construction_SKILL` 这个 skill 交给 agent 构建即可：

```text
请根据 mobilejail/Z-越狱构建/task.json，
调用 mobilejail/Z-Jailbreak_Construction_SKILL 这个 skill，
构建可运行的 jailbreak_json 任务，并完成验证。
```

agent 会根据 skill 的说明自动完成任务构建、代码生成和验证。生成结果主要在：

- `bench_env/generated_task/jailbreak_json/`
- `bench_env/tests/jailbreak_json/`

## 3. 启动 MobileGym 服务

先构建前端：

```bash
npm run build
```

单 agent 调试可以用 Vite preview：

```bash
npm run preview -- --port 4173
```

多进程/多浏览器 benchmark 推荐启动 Nginx gateway，默认端口是 `4180`：

```bash
./scripts/server/start_nginx_gateway.sh
```

启动后评测地址是：

```text
https://localhost:4180
```

停止服务：

```bash
./scripts/server/start_nginx_gateway.sh stop
```

## 4. 运行 jailbreak_json 任务

运行 T0001-T0010：

```bash
.venv-py312/bin/python -m bench_env.run --task-range jailbreak_json.1-10 \
  --parallel 32 --processes 4 --browsers 8 --isolation pages \
  --headless \
  --env-url https://localhost:4180 \
  --agent generic_v2 \
  --model-name "Qwen3.5-122B-A10B" \
  --model-base-url "xxxxx" \
  --model-api-key "xxxxx"
```

`bench_env.run` 对 `jailbreak_json.1-10` 已有默认运行配置；如果环境变量已设置，也可以写得更短：

```bash
export MODEL_BASE_URL="xxxxx"
export MODEL_API_KEY="xxxxx"
export MODEL_NAME="Qwen3.5-122B-A10B"
export BENCH_AGENT="generic_v2"

.venv-py312/bin/python -m bench_env.run --task-range jailbreak_json.1-10
```

常用参数含义：

- `--task-range jailbreak_json.1-10`：运行构建出来的第 1 到第 10 个任务。
- `--env-url https://localhost:4180`：连接本地 Nginx gateway。
- `--agent generic_v2`：使用通用 agent。
- `--parallel 32 --processes 4 --browsers 8 --isolation pages`：并行跑任务。
- `--headless`：无界面浏览器运行。
- `--model-name / --model-base-url / --model-api-key`：外部 OpenAI-compatible 模型配置。

## 5. 查看结果

每次运行会在 `runs/` 下生成一个新目录。重点看：

- `summary.json`：总体成功率和错误统计。
- `results.jsonl`：每个任务的结果。
- `errors.jsonl`：失败或异常原因。
- `console.log`：运行日志。
- `browser_logs/`：浏览器侧日志。
- `shards/`：并行分片日志。

## 典型完整流程

```bash
cd mobilegym-main

# 1. 修改 Z-越狱构建/task.json

# 2. 把 task.json 和 Z-Jailbreak_Construction_SKILL 交给 agent 构建 jailbreak_json suite

# 3. 启动服务
npm run build
./scripts/server/start_nginx_gateway.sh

# 4. 运行评测
.venv-py312/bin/python -m bench_env.run --task-range jailbreak_json.1-10 \
  --parallel 32 --processes 4 --browsers 8 --isolation pages \
  --headless \
  --env-url https://localhost:4180 \
  --agent generic_v2 \
  --model-name "Qwen3.5-122B-A10B" \
  --model-base-url "xxxxx" \
  --model-api-key "xxxxx"
```

## 常见问题

如果 Python 版本报错，确认使用的是 Python 3.11+：

```bash
.venv-py312/bin/python --version
```

如果缺依赖，重新安装：

```bash
.venv-py312/bin/pip install -r bench_env/requirements.txt
```

如果 `https://localhost:4180` 无法访问，先确认 gateway 是否启动：

```bash
./scripts/server/start_nginx_gateway.sh
```

如果修改了 `task.json`，不要直接改 `bench_env/generated_task/jailbreak_json/`，重新运行构建命令即可。
