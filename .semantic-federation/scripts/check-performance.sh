#!/usr/bin/env bash
set -euo pipefail

commands_file=${PERFORMANCE_COMMANDS:-quality/performance-commands.txt}
if [[ ! -f "$commands_file" ]]; then
  echo "Performance command list is missing: $commands_file" >&2
  exit 2
fi

count=0
while IFS= read -r command || [[ -n "$command" ]]; do
  command=${command%%#*}
  command=${command#"${command%%[![:space:]]*}"}
  command=${command%"${command##*[![:space:]]}"}
  [[ -z "$command" ]] && continue
  count=$((count + 1))
  echo "performance_rail[$count]=$command"
  sh -c "$command"
done < "$commands_file"

if (( count == 0 )); then
  echo "No performance rails configured in $commands_file" >&2
  exit 2
fi

echo "performance_quality=passed commands=$count"
