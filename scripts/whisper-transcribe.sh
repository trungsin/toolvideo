#!/bin/bash
# Transcribe audio with word-level timestamps using whisper.cpp
# Usage: whisper-transcribe.sh <audio_file> <output_json>

set -e

AUDIO_FILE="$1"
OUTPUT_FILE="$2"
MODEL="${WHISPER_MODEL:-base}"
LANGUAGE="${WHISPER_LANG:-auto}"

if [ -z "$AUDIO_FILE" ] || [ -z "$OUTPUT_FILE" ]; then
  echo '{"error": "Usage: whisper-transcribe.sh <audio> <output>"}'
  exit 1
fi

if [ ! -f "$AUDIO_FILE" ]; then
  echo "{\"error\": \"Audio file not found: $AUDIO_FILE\"}"
  exit 1
fi

# Find whisper.cpp model path
MODEL_PATH=""
POSSIBLE_PATHS=(
  "$HOME/.cache/whisper-cpp/ggml-${MODEL}.bin"
  "$HOME/Library/Application Support/whisper.cpp/ggml-${MODEL}.bin"
  "/usr/local/share/whisper.cpp/ggml-${MODEL}.bin"
  "/opt/homebrew/share/whisper.cpp/ggml-${MODEL}.bin"
  "/opt/whisper.cpp/models/ggml-${MODEL}.bin"
)

for path in "${POSSIBLE_PATHS[@]}"; do
  if [ -f "$path" ]; then
    MODEL_PATH="$path"
    break
  fi
done

if [ -z "$MODEL_PATH" ]; then
  echo "{\"error\": \"Model not found. Run: whisper-cpp-download-ggml-model $MODEL\"}"
  exit 1
fi

# Convert to 16kHz mono WAV (whisper.cpp requirement)
TEMP_WAV="/tmp/whisper_input_$$.wav"
trap "rm -f '$TEMP_WAV'" EXIT

echo '{"status": "converting_audio"}' >&2

ffmpeg -i "$AUDIO_FILE" -ar 16000 -ac 1 -f wav "$TEMP_WAV" -y 2>/dev/null

if [ ! -f "$TEMP_WAV" ]; then
  echo '{"error": "Failed to convert audio to WAV"}'
  exit 1
fi

echo '{"status": "transcribing"}' >&2

# Create output directory if needed
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Run whisper.cpp with JSON output
# --output-json outputs to <input>.json
# --max-len 1 enables word-level timestamps
TEMP_OUTPUT="/tmp/whisper_output_$$"

LANG_FLAG=""
if [ "$LANGUAGE" != "auto" ]; then
  LANG_FLAG="--language $LANGUAGE"
fi

# Word-level timestamps work poorly for non-English
# Use sentence-level for Asian languages (vi, ko, ja, zh, th)
MAX_LEN_FLAG="--max-len 1"
WORD_THOLD_FLAG=""
case "$LANGUAGE" in
  vi|ko|ja|zh|th|auto)
    # For Asian languages and auto-detect: use sentence-level
    # This prevents [Silence] [Singing] artifacts
    MAX_LEN_FLAG=""
    WORD_THOLD_FLAG="--word-thold 0.01"
    ;;
esac

whisper-cli \
  --model "$MODEL_PATH" \
  $LANG_FLAG \
  $MAX_LEN_FLAG \
  $WORD_THOLD_FLAG \
  --output-json \
  --output-file "$TEMP_OUTPUT" \
  "$TEMP_WAV" 2>/dev/null

# Check if JSON was created
if [ -f "${TEMP_OUTPUT}.json" ]; then
  mv "${TEMP_OUTPUT}.json" "$OUTPUT_FILE"
  echo "{\"status\": \"complete\", \"output\": \"$OUTPUT_FILE\"}"
else
  # Fallback: check if whisper created output with different naming
  if [ -f "${TEMP_WAV}.json" ]; then
    mv "${TEMP_WAV}.json" "$OUTPUT_FILE"
    echo "{\"status\": \"complete\", \"output\": \"$OUTPUT_FILE\"}"
  else
    echo '{"error": "Whisper transcription failed - no output generated"}'
    exit 1
  fi
fi
