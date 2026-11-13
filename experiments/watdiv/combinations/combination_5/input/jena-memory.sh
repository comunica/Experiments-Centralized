#!/bin/sh

# Fuseki with an in-memory dataset, loaded from the file before the server accepts requests (instead of a TDB2 database).
# The heap must hold the whole dataset; override it with JVM_ARGS.
# Fuseki exits when the heap runs out, instead of never answering.
export JVM_ARGS=${JVM_ARGS:--Xmx100G -XX:+ExitOnOutOfMemoryError}

# The live heap of the running server in bytes, after a full garbage collection
live_heap() {
  jcmd "$(jcmd | awk '/fuseki/ { print $1; exit }')" GC.class_histogram | awk '/^Total/ { print $3 }'
}

# The store size is the live heap after loading, minus that of a server with an empty dataset
./fuseki-server --port 3002 --mem /mydataset > /dev/null 2>&1 &
until curl -s -o /dev/null http://127.0.0.1:3002/; do sleep 0.2; done
heap_before=$(live_heap)
kill $!
wait $!

# Ingestion time includes the server startup, as the server only answers once the file is loaded
ingestion_start=$(date +%s%3N)
./fuseki-server --timeout=300000 --port 3000 --file=/staging/dataset.nt /mydataset &
until curl -s -o /dev/null http://127.0.0.1:3000/; do sleep 0.2; done
ingestion_time=$(( $(date +%s%3N) - ingestion_start ))
echo "JBR_INGESTION_TIME_S $(( ingestion_time / 1000 )).$(printf %03d $(( ingestion_time % 1000 )))"
echo "JBR_STORE_SIZE_BYTES $(( $(live_heap) - heap_before )) memory"
wait
