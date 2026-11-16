#!/usr/bin/env bash
# Draw extra instances with the kit's generator into .cache/gen/<seed-index>/ (cases + marked's HTML).
#   tools/gen.sh <kit-dir> <from> <to>
set -euo pipefail
kit="$1"; from="$2"; to="$3"
for i in $(seq "$from" "$to"); do
  dir=".cache/gen/$i"
  [ -f "$dir/out/input/cases.json" ] && continue
  mkdir -p "$dir/in" "$dir/out"
  seed=$(node -e "console.log(require('node:crypto').createHash('sha256').update('fast-marked test seed '+process.argv[1]).digest('hex'))" "$i")
  printf '{"schema":"agent-fun/instance-seed/v1","seed":"%s"}\n' "$seed" > "$dir/in/seed.json"
  MAKEFUN_INPUT_DIR="$dir/in" MAKEFUN_OUTPUT_DIR="$dir/out" node "$kit/program/generator/draw.ts"
done
