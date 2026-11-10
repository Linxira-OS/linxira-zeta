#!/bin/sh
# Launch the source checkout under the developer isolation profile.
# Thin wrapper around scripts/dev-isolated.ts; see docs/dev-isolation.md.
set -e
if ! command -v bun >/dev/null 2>&1; then
	echo "dev-isolated: bun is required on PATH (https://bun.sh)" >&2
	exit 1
fi
exec bun "$(dirname "$0")/dev-isolated.ts" "$@"
