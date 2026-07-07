#!/usr/bin/env bash
# ============================================================
# bench_nginx.sh - 多实例 Vite Preview + Nginx 负载均衡
# 解决 128 并行 __SIM_FS__ 超时问题
#
# 用法:
#   ./scripts/bench_nginx.sh start   # 启动 nginx + preview 实例
#   ./scripts/bench_nginx.sh stop    # 停止所有
#   ./scripts/bench_nginx.sh status  # 查看状态
# ============================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTANCES=4
BASE_PORT=4173
NGINX_PORT=4180
NGINX_CONF="$PROJECT_ROOT/scripts/nginx-bench.conf"
PID_DIR="$PROJECT_ROOT/.bench_pids"

# ---------- helpers ----------

log() { echo "[$(date +%H:%M:%S)] $*"; }

check_nginx() {
    if ! command -v nginx &>/dev/null; then
        log "nginx 未安装，正在通过 brew 安装..."
        HOMEBREW_NO_AUTO_UPDATE=1 brew install nginx
    fi
    nginx -v 2>&1
}

# ---------- commands ----------

do_start() {
    mkdir -p "$PID_DIR"

    # 0. 确认 dist 存在
    if [ ! -f "$PROJECT_ROOT/dist/index.html" ]; then
        log "dist/ 不存在，先 build..."
        (cd "$PROJECT_ROOT" && npm run build)
    fi

    # 1. 检查并安装 nginx
    check_nginx

    # 2. 启动 preview 实例
    for i in $(seq 0 $((INSTANCES - 1))); do
        port=$((BASE_PORT + i))
        pidfile="$PID_DIR/preview_${port}.pid"

        if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
            log "preview :$port already running (pid=$(cat "$pidfile"))"
            continue
        fi

        log "启动 preview 实例 :$port"
        npx vite preview --port "$port" --strictPort \
            > "$PID_DIR/preview_${port}.log" 2>&1 &
        echo $! > "$pidfile"
    done

    # 等待 preview 实例就绪
    log "等待 preview 实例就绪..."
    for i in $(seq 0 $((INSTANCES - 1))); do
        port=$((BASE_PORT + i))
        for _ in $(seq 1 30); do
            if curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/" 2>/dev/null | grep -q '200'; then
                break
            fi
            sleep 1
        done
        log "preview :$port 就绪"
    done

    # 3. 启动 nginx（使用独立完整配置，不走 include）
    log "测试 nginx 配置..."
    if ! nginx -t -c "$NGINX_CONF" 2>&1; then
        log "nginx 配置测试失败!"
        cat "$NGINX_CONF"
        exit 1
    fi

    log "启动 nginx :$NGINX_PORT"
    nginx -c "$NGINX_CONF"
    echo $$ > "$PID_DIR/nginx.pid"

    # 4. 验证
    sleep 1
    if curl -s -o /dev/null -w '%{http_code}' "http://localhost:$NGINX_PORT/" 2>/dev/null | grep -q '200'; then
        log "============================================="
        log "  全部就绪!  访问: http://localhost:$NGINX_PORT"
        log "  Preview 实例: $INSTANCES (端口 $BASE_PORT-$((BASE_PORT+INSTANCES-1)))"
        log "============================================="
        log ""
        log "推荐运行命令:"
        log "  python -m bench_env.run --split test \\"
        log "    --parallel 32 --processes 4 --browsers 4 --isolation pages \\"
        log "    --env-url http://localhost:$NGINX_PORT \\"
        log "    --agent generic_v2 --model-name \"Qwen3.5-122B-A10B\" \\"
        log "    --model-base-url \"https://antchat.alipay.com/v1/\" \\"
        log "    --model-api-key \"\$MODEL_API_KEY\" \\"
        log "    --headless"
    else
        log "警告: nginx 端口 :$NGINX_PORT 未响应，请检查"
        log "尝试手动: nginx -t -c $NGINX_CONF"
    fi
}

do_stop() {
    log "停止 preview 实例..."
    for i in $(seq 0 $((INSTANCES - 1))); do
        port=$((BASE_PORT + i))
        pidfile="$PID_DIR/preview_${port}.pid"
        if [ -f "$pidfile" ]; then
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null && log "已停止 preview :$port (pid=$pid)"
            fi
            rm -f "$pidfile"
        fi
    done

    # 停止 nginx（用 -c 指定配置才能匹配到正确的实例）
    log "停止 nginx..."
    nginx -s stop -c "$NGINX_CONF" 2>/dev/null && log "已停止 nginx" || {
        # fallback：暴力停止所有 nginx worker
        pkill -f "nginx.*bench" 2>/dev/null && log "已强制停止 nginx" || true
    }
    rm -f "$PID_DIR/nginx.pid"

    log "全部已停止"
}

do_status() {
    echo "=== Preview 实例 ==="
    for i in $(seq 0 $((INSTANCES - 1))); do
        port=$((BASE_PORT + i))
        pidfile="$PID_DIR/preview_${port}.pid"
        if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
            echo "  :$port  运行中 (pid=$(cat "$pidfile"))"
        else
            echo "  :$port  未运行"
        fi
    done
    echo ""
    echo "=== Nginx ==="
    if curl -s -o /dev/null -w '%{http_code}' "http://localhost:$NGINX_PORT/" 2>/dev/null | grep -q '200'; then
        echo "  :$NGINX_PORT  运行中"
    else
        echo "  :$NGINX_PORT  未运行"
    fi
}

# ---------- main ----------

case "${1:-}" in
    start)  do_start  ;;
    stop)   do_stop   ;;
    status) do_status ;;
    *)
        echo "用法: $0 {start|stop|status}"
        echo ""
        echo "  start  - 启动多实例 preview + nginx"
        echo "  stop   - 停止所有"
        echo "  status - 查看状态"
        exit 1
        ;;
esac
