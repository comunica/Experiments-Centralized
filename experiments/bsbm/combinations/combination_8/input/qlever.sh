#!/bin/sh
# Inspired by https://github.com/ad-freiburg/qlever/blob/master/docker-entrypoint.sh

# Index dataset
echo ">>> Indexing dataset..."
ingestion_start=$(date +%s%3N)
qlever index
ingestion_time=$(( $(date +%s%3N) - ingestion_start ))
echo "JBR_INGESTION_TIME_S $(( ingestion_time / 1000 )).$(printf %03d $(( ingestion_time % 1000 )))"

# Start server on actual port
echo ">>> Starting final server"
qlever start
qlever log
