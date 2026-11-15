#!/bin/sh

# Fuseki with an in-memory dataset, loaded from the file before the server accepts requests (instead of a TDB2 database).
# The heap must hold the whole dataset; override it with JVM_ARGS.
# Fuseki exits when the heap runs out, instead of never answering.
export JVM_ARGS=${JVM_ARGS:--Xmx100G -XX:+ExitOnOutOfMemoryError}

# The live heap of the running server in bytes, after a full garbage collection, or nothing if jcmd fails.
# Right after loading a large dataset, the JVM can take longer to attach to than jcmd's default 10 s, so wait longer and retry.
live_heap() {
  pid=$(jcmd | awk '/fuseki/ { print $1; exit }')
  for attempt in 1 2 3; do
    size=$(jcmd -J-Dsun.tools.attach.attachTimeout=120000 "$pid" GC.class_histogram | awk '/^Total/ { print $3 }')
    if [ -n "$size" ]; then
      echo "$size"
      return
    fi
    sleep 10
  done
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
heap_after=$(live_heap)
if [ -n "$heap_before" ] && [ -n "$heap_after" ]; then
  echo "JBR_STORE_SIZE_BYTES $(( heap_after - heap_before )) memory"
else
  echo "Could not measure the store size, as jcmd could not attach to the server"
fi
wait
