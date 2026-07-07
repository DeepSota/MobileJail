#!/usr/bin/env bash
# ============================================================
# bench_run.sh - 一键运行 benchmark
# 自动检测 nginx 是否启动，按推荐并行数运行
#
# 用法:
#   ./scripts/bench_run.sh              # 默认 4 并行（安全）
#   ./scripts/bench_run.sh 8            # 指定并行数
# ============================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARALLEL="${1:-8}"
NGINX_PORT=4184
DIRECT_PORT=4173

# ---- 模型配置（按需修改）----
MODEL_NAME="${MODEL_NAME:-Qwen3.6-35B-A3B}"
MODEL_BASE_URL="${MODEL_BASE_URL:-https://antchat.alipay.com/v1/}"
MODEL_API_KEY="${MODEL_API_KEY:-}"

if [ -z "$MODEL_API_KEY" ]; then
    echo "[bench_run] 错误: 请先设置 MODEL_API_KEY 环境变量"
    exit 1
fi

# 根据并行数自动推算 processes 和 browsers
if [ "$PARALLEL" -le 4 ]; then
    PROCESSES=1
    BROWSERS=1
elif [ "$PARALLEL" -le 8 ]; then
    PROCESSES=1
    BROWSERS=2
elif [ "$PARALLEL" -le 16 ]; then
    PROCESSES=2
    BROWSERS=2
elif [ "$PARALLEL" -le 32 ]; then
    PROCESSES=4
    BROWSERS=4
else
    PROCESSES=$((PARALLEL / 8))
    BROWSERS=$PROCESSES
fi

# 检测 env-url: 优先用 nginx，回退到直连
if curl -s -o /dev/null -w '%{http_code}' "http://localhost:$NGINX_PORT/" 2>/dev/null | grep -q '200'; then
    ENV_URL="http://localhost:$NGINX_PORT"
    echo "[bench_run] 使用 nginx 网关: $ENV_URL"
elif curl -s -o /dev/null -w '%{http_code}' "http://localhost:$DIRECT_PORT/" 2>/dev/null | grep -q '200'; then
    ENV_URL="http://localhost:$DIRECT_PORT"
    echo "[bench_run] nginx 未启动，回退直连: $ENV_URL"
    if [ "$PARALLEL" -gt 4 ]; then
        echo "[bench_run] 警告: 直连模式建议 parallel <= 4，当前=$PARALLEL"
        echo "[bench_run] 建议先运行: ./scripts/bench_nginx.sh start"
        exit 1
    fi
else
    echo "[bench_run] 错误: 没有可用的服务器"
    echo "[bench_run] 请先运行:"
    echo "  npm run preview    # 直连模式"
    echo "  ./scripts/bench_nginx.sh start  # nginx 模式"
    exit 1
fi

echo "[bench_run] ============================================"
echo "[bench_run] 模型:   $MODEL_NAME"
echo "[bench_run] 并行:   $PARALLEL"
echo "[bench_run] 进程:   $PROCESSES"
echo "[bench_run] 浏览器: $BROWSERS"
echo "[bench_run] URL:    $ENV_URL"
echo "[bench_run] ============================================"
echo ""

if [ "$PROCESSES" -eq 1 ]; then
    python -m bench_env.run --split test \
        --parallel "$PARALLEL" \
        --env-url "$ENV_URL" \
        --agent generic_v2 \
        --model-name "$MODEL_NAME" \
        --model-base-url "$MODEL_BASE_URL" \
        --model-api-key "$MODEL_API_KEY" \
        --headless
else
    python -m bench_env.run --split test \
        --parallel "$PARALLEL" --processes "$PROCESSES" --browsers "$BROWSERS" --isolation pages \
        --env-url "$ENV_URL" \
        --agent generic_v2 \
        --model-name "$MODEL_NAME" \
        --model-base-url "$MODEL_BASE_URL" \
        --model-api-key "$MODEL_API_KEY" \
        --headless
fi
