#!/usr/bin/env bash
set -e
echo "Starting Frontera Noise Dashboard..."
if [ ! -d node_modules ]; then
  echo "Installing dependencies for the first time..."
  npm install
fi
echo "Open http://localhost:3000 in your browser."
npm run dev
