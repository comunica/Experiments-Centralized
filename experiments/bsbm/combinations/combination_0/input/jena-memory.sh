#!/bin/sh

# Fuseki with an in-memory dataset, loaded from the file before the server accepts requests (instead of a TDB2 database).
# The heap must hold the whole dataset; override it with JVM_ARGS.
export JVM_ARGS=${JVM_ARGS:--Xmx8G}

# Ingestion time includes the server startup, as the server only answers once the file is loaded
ingestion_start=$(date +%s%3N)
./fuseki-server --timeout=300000 --port 3000 --file=/staging/dataset.nt /mydataset &
until curl -s -o /dev/null http://127.0.0.1:3000/; do sleep 0.2; done
ingestion_time=$(( $(date +%s%3N) - ingestion_start ))
echo "JBR_INGESTION_TIME_S $(( ingestion_time / 1000 )).$(printf %03d $(( ingestion_time % 1000 )))"
wait
