#!/usr/bin/env bash

# Monitor aw-watcher-tmux heartbeats and idle detection
# Usage: ./monitor-aw.sh [--follow]

BUCKET="aw-watcher-tmux_nixos"
AW_HOST="${AW_HOST:-localhost}"
AW_PORT="${AW_PORT:-5601}"
FOLLOW=false

if [ "$1" == "--follow" ] || [ "$1" == "-f" ]; then
    FOLLOW=true
fi

echo "Monitoring ActivityWatch heartbeats for bucket: $BUCKET"
echo "AW Server: $AW_HOST:$AW_PORT"
echo "Press Ctrl+C to stop"
echo ""

# Function to get recent events
get_events() {
    curl -s "http://$AW_HOST:$AW_PORT/api/0/buckets/$BUCKET/events?limit=5" 2>/dev/null | \
        jq -r '.[] | "\(.timestamp) | \(.data.session) | \(.data.pane_path) | \(.data.pane_cmd)"' 2>/dev/null || \
        echo "Error: Cannot connect to ActivityWatch"
}

# Function to get last heartbeat time
get_last_heartbeat() {
    curl -s "http://$AW_HOST:$AW_PORT/api/0/buckets/$BUCKET/events?limit=1" 2>/dev/null | \
        jq -r '.[0].timestamp' 2>/dev/null
}

if [ "$FOLLOW" = true ]; then
    LAST_TIME=""
    SKIP_COUNT=0
    TOTAL_CHECKS=0
    
    while true; do
        CURRENT_TIME=$(get_last_heartbeat)
        TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
        
        if [ -n "$CURRENT_TIME" ] && [ "$CURRENT_TIME" != "null" ]; then
            if [ "$CURRENT_TIME" != "$LAST_TIME" ]; then
                # New heartbeat received
                TIMESTAMP=$(echo "$CURRENT_TIME" | sed 's/T/ /' | sed 's/\.[0-9]*Z//')
                echo "[$(date '+%H:%M:%S')] Heartbeat: $TIMESTAMP"
                SKIP_COUNT=0
                LAST_TIME="$CURRENT_TIME"
            else
                # No new heartbeat (skipped due to idle)
                SKIP_COUNT=$((SKIP_COUNT + 1))
                if [ $((SKIP_COUNT % 2)) -eq 0 ]; then
                    echo "[$(date '+%H:%M:%S')] No heartbeat (idle detection active) - skipped $SKIP_COUNT consecutive polls"
                fi
            fi
        else
            echo "[$(date '+%H:%M:%S')] Error: No data from ActivityWatch"
        fi
        
        sleep 10
    done
else
    # Single check mode
    echo "Recent heartbeats:"
    get_events
    echo ""
    echo "To continuously monitor, run: $0 --follow"
fi
