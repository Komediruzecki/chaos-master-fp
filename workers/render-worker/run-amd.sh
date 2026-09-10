#!/bin/bash
set -e

# Setup script directory context
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR/../.."

echo "Building Docker image for AMD GPU renderer..."
docker build -f workers/render-worker/Dockerfile -t chaos-render-worker .

echo "Running Deno GPU renderer with AMD GPU device passthrough (/dev/dri)..."
docker run --rm -it \
  --device /dev/dri \
  -p 8787:8787 \
  chaos-render-worker
