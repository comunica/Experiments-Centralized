#!/bin/sh

JAVA_OPTS="-Xmx4g"

# Create blazegraph user
addgroup -S -g $BLAZEGRAPH_GID blazegraph
adduser -S -s /bin/false -G blazegraph -u $BLAZEGRAPH_UID blazegraph

# Make sure permissions are good
chown -R blazegraph:blazegraph "$JETTY_BASE"
chown -R blazegraph:blazegraph "$TMPDIR"

# Start temporary server on a different port
su-exec blazegraph:blazegraph java $JAVA_OPTS -Djetty.port=8000 -Dcom.bigdata.rdf.sail.webapp.ConfigParams.propertyFile=/RWStore.properties -jar /usr/local/jetty/start.jar jetty.server.stopAtShutdown=true &
pid=$!

# Wait until the SPARQL endpoint is up, which answers 404 for a short while after /bigdata/ is up
echo "Waiting for Blazegraph to finish starting up..."
until curl --output /dev/null --silent --fail http://localhost:8000/bigdata/sparql; do
  sleep 1s
done

# Load dataset
echo "Loading dataset..."
# Stream the file (-T), as --data-binary @file reads it into memory, which curl 8 refuses above 1 GiB.
# Exit if loading fails, so that the experiment stops instead of querying an empty store.
if ! curl -X POST --fail \
  -T /staging/dataset.nt \
  --header 'Content-Type:text/plain' \
  --write-out '\nJBR_INGESTION_TIME_S %{time_total} (HTTP %{http_code})\n' \
  http://localhost:8000/bigdata/sparql; then
  echo "Loading the dataset failed"
  kill -TERM $pid
  exit 1
fi
echo "Dataset has been loaded, stopping temporary server"
kill -TERM $pid
wait $pid
echo "JBR_STORE_SIZE_BYTES $(( $(du -k bigdata.jnl | cut -f1) * 1024 )) disk"

# Start server on actual port
echo "Starting final server"
su-exec blazegraph:blazegraph java $JAVA_OPTS -Dcom.bigdata.rdf.sail.webapp.ConfigParams.propertyFile=/RWStore.properties -jar /usr/local/jetty/start.jar
