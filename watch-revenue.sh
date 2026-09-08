#!/usr/bin/env bash
while true; do
  clear
  node monitor-revenue.js
  echo ""
  echo "Refreshing in 30 seconds... (Press Ctrl+C to exit)"
  sleep 30
done
