#!/usr/bin/env bash
set -euo pipefail

THEMES_DIR="internal/config/themes"
OUTPUT_DIR="docs-web/public/themes"
TAPE_DIR=$(mktemp -d)
CONFIG_DIR=$(mktemp -d)
TTT_BIN="$(pwd)/bin/ttt"
SAMPLE_FILE="$(pwd)/internal/config/theme.go"
VHS="$(go env GOPATH)/bin/vhs"
MAX_JOBS=4

mkdir -p "$OUTPUT_DIR"

trap 'rm -rf "$TAPE_DIR" "$CONFIG_DIR"; kill $(jobs -p) 2>/dev/null' EXIT

run_theme() {
  local theme_name="$1"
  local output_file="$OUTPUT_DIR/${theme_name}.png"
  local config_file="$CONFIG_DIR/${theme_name}.json"
  local tape_file="$TAPE_DIR/${theme_name}.tape"

  cat > "$config_file" <<CONF
{
  "version": 1,
  "theme": "$theme_name",
  "editor": {
    "tabSize": 4,
    "insertSpaces": true,
    "lineNumbers": true,
    "gutterStyle": "compact"
  }
}
CONF

  cat > "$tape_file" <<TAPE
Output "$output_file"
Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 900
Set Padding 0

Type "$TTT_BIN --config $config_file . $SAMPLE_FILE"
Enter
Sleep 1.5s

Ctrl+t
Sleep 800ms
Type "export PS1='$ '"
Enter
Sleep 300ms
Type "clear && ls"
Enter
Sleep 800ms

Screenshot "$output_file"
TAPE

  "$VHS" "$tape_file" 2>&1 | tail -1 || echo "FAILED: $theme_name"
  echo "DONE: $theme_name"
}

count=0
total=0

for theme_file in "$THEMES_DIR"/*.json; do
  theme_name=$(basename "$theme_file" .json)

  case "$theme_name" in
    default-dark|default-light|aurora|bubblegum|hotline|monokai|one-dark|solarized-dark|solarized-light|virtru-dark|high-contrast-dark|high-contrast-light)
      continue
      ;;
  esac

  output_file="$OUTPUT_DIR/${theme_name}.png"
  if [ -f "$output_file" ]; then
    echo "SKIP (exists): $theme_name"
    continue
  fi

  total=$((total + 1))
  run_theme "$theme_name" &
  count=$((count + 1))

  if [ $count -ge $MAX_JOBS ]; then
    wait -n
    count=$((count - 1))
  fi
done

wait
echo ""
echo "Done! Screenshots saved to $OUTPUT_DIR/"
ls -1 "$OUTPUT_DIR"/*.png 2>/dev/null | wc -l
echo "screenshots generated"
