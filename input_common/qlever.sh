#!/bin/sh
# Inspired by https://github.com/ad-freiburg/qlever/blob/master/docker-entrypoint.sh

# Index dataset
echo ">>> Indexing dataset..."
qlever index

# Start server on actual port
echo ">>> Starting final server"
qlever start
qlever log
