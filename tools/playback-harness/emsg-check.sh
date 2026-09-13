#!/usr/bin/env bash
set -u

BASE_URL=${1:?base URL required}
VIDEO_FILE_ID=${2:?videoFileId required}
MODE=${3:-0}
SEEK_SECONDS=${4:-300}
MIN_RATIO=${5:-1}
MIN_SEGMENTS=${6:-3}

if ! command -v curl >/dev/null 2>&1; then
    echo 'curl が必要' >&2
    exit 2
fi
if ! command -v ffprobe >/dev/null 2>&1; then
    echo 'ffprobe が必要' >&2
    exit 2
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/epgstation-emsg.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

START_JSON=$(curl --fail --silent --show-error --max-time 30 \
    "${BASE_URL%/}/api/streams/recorded/${VIDEO_FILE_ID}/hls?mode=${MODE}&ss=${SEEK_SECONDS}&audioTrack=all") || exit 1
STREAM_ID=$(printf '%s' "$START_JSON" | sed -n 's/.*"streamId"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
if [ -z "$STREAM_ID" ]; then
    echo "streamId を取得できない: $START_JSON" >&2
    exit 1
fi

PLAYLIST_URL="${BASE_URL%/}/streamfiles/stream${STREAM_ID}.m3u8"
PLAYLIST=''
for _ in $(seq 1 40); do
    PLAYLIST=$(curl --silent --max-time 6 "$PLAYLIST_URL" || true)
    if printf '%s' "$PLAYLIST" | grep -qE 'stream[0-9]+-[0-9]+\.m4s'; then break; fi
    sleep 1
done

SEGMENT_LIST=$(printf '%s' "$PLAYLIST" | grep -oE 'stream[0-9]+-[0-9]+\.m4s' | awk '!seen[$0]++' | head -20)
SEGMENT_COUNT=$(printf '%s\n' "$SEGMENT_LIST" | grep -c . || true)
if [ "$SEGMENT_COUNT" -lt "$MIN_SEGMENTS" ]; then
    echo "セグメント不足: ${SEGMENT_COUNT} < ${MIN_SEGMENTS}" >&2
    exit 1
fi

INIT_URI=$(printf '%s\n' "$PLAYLIST" | sed -n 's/.*URI="\([^"]*\.m4s\)".*/\1/p' | head -1)
INIT_FILE="$TMP_DIR/init.m4s"
if [ -n "$INIT_URI" ]; then curl --fail --silent --show-error --max-time 10 "${BASE_URL%/}/streamfiles/$INIT_URI" -o "$INIT_FILE" || :; fi

EMSG_COUNT=0
VALID_COUNT=0
while IFS= read -r segment; do
    [ -z "$segment" ] && continue
    FILE="$TMP_DIR/$segment"
    if ! curl --fail --silent --show-error --max-time 10 "${BASE_URL%/}/streamfiles/$segment" -o "$FILE"; then continue; fi
    if [ ! -s "$FILE" ]; then continue; fi
    PROBE_FILE="$FILE"
    if [ -s "$INIT_FILE" ]; then
        PROBE_FILE="$TMP_DIR/probe-$segment"
        cat "$INIT_FILE" "$FILE" > "$PROBE_FILE"
    fi
    if ! ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$PROBE_FILE" >/dev/null 2>&1; then continue; fi
    VALID_COUNT=$((VALID_COUNT + 1))
    if grep -qa 'emsg' "$PROBE_FILE"; then EMSG_COUNT=$((EMSG_COUNT + 1)); fi
done <<EOF
$SEGMENT_LIST
EOF

if [ "$VALID_COUNT" -eq 0 ]; then
    echo 'ffprobe で読めるセグメントなし' >&2
    exit 1
fi
RATIO=$(awk -v count="$EMSG_COUNT" -v total="$VALID_COUNT" 'BEGIN { printf "%.3f", count / total }')
printf 'videoFileId=%s mode=%s segments=%s valid=%s emsg=%s ratio=%s\n' "$VIDEO_FILE_ID" "$MODE" "$SEGMENT_COUNT" "$VALID_COUNT" "$EMSG_COUNT" "$RATIO"
if awk -v ratio="$RATIO" -v minimum="$MIN_RATIO" 'BEGIN { exit !(ratio >= minimum) }'; then exit 0; fi
exit 1
