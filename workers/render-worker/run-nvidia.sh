#!/bin/bash
set -e

# Setup script directory context
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR/../.."

echo "Building Docker image for NVIDIA GPU renderer..."
docker build -f workers/render-worker/Dockerfile -t chaos-render-worker .

echo "------------------------------------------------------------"
echo "To deploy this image to RunPod or other NVIDIA cloud hosts:"
echo "1. Tag the image for your container registry (e.g., Docker Hub or GHCR):"
echo "   docker tag chaos-render-worker:latest <username>/chaos-render-worker:latest"
echo "2. Push the tagged image to the registry:"
echo "   docker push <username>/chaos-render-worker:latest"
echo "3. In RunPod, launch a new Pod using:"
echo "   - Container Image: <username>/chaos-render-worker:latest"
echo "   - Exposed Ports: 8787"
echo "   - Environment Variable: PORT=8787"
echo "------------------------------------------------------------"
echo ""

echo "Running Deno GPU renderer locally with NVIDIA GPU passthrough (--gpus all)..."
docker run --rm -it \
  --gpus all \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute \
  -p 8787:8787 \
  chaos-render-worker
