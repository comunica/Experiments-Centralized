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

# Wait until server is up
echo "Waiting for Blazegraph to finish starting up..."
until $(curl --output /dev/null --silent --head --fail http://localhost:8000/bigdata/); do
  sleep 1s
done

# Load dataset
echo "Loading dataset..."
curl -X POST \
  --data-binary @/staging/dataset.nt \
  --header 'Content-Type:text/plain' \
  http://localhost:8000/bigdata/sparql
echo "Dataset has been loaded, stopping temporary server"
kill -TERM $pid

# Start server on actual port
echo "Starting final server"
su-exec blazegraph:blazegraph java $JAVA_OPTS -Dcom.bigdata.rdf.sail.webapp.ConfigParams.propertyFile=/RWStore.properties -jar /usr/local/jetty/start.jar
