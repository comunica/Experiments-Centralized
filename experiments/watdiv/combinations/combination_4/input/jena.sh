#!/bin/sh

# Load dataset
ingestion_start=$(date +%s%3N)
$FUSEKI_HOME/tdbloader2 $TDBLOADER_OPTS --loader=parallel --loc=$FUSEKI_BASE/databases/mydataset /staging/dataset.nt
ingestion_time=$(( $(date +%s%3N) - ingestion_start ))
echo "JBR_INGESTION_TIME_S $(( ingestion_time / 1000 )).$(printf %03d $(( ingestion_time % 1000 )))"

# Start server on port 3030
./fuseki-server --tdb2 --timeout=300000 --port 3000 --loc=$FUSEKI_BASE/databases/mydataset /mydataset
