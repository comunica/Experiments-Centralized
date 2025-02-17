#!/bin/sh
# Inspired by https://github.com/openlink/vos-reference-docker/blob/develop/virtuoso-entrypoint.sh

# Set default password
export DBA_PASSWORD=dba

# Start temporary server on a different port
/virtuoso-entrypoint.sh start &
pid=$!

# Wait until server is up
echo ">>> Waiting for Virtuoso to finish starting up..."
until $(curl --output /dev/null --silent --head --fail http://localhost:8890/); do
  sleep 1s
done

# Load dataset
echo ">>> Loading dataset..."
mkdir -p /usr/share/proj
cp /staging/dataset.nt /usr/share/proj/dataset.nt
/virtuoso-entrypoint.sh isql <<EOF
SPARQL CREATE GRAPH <urn:default-graph>;
ld_dir('/usr/share/proj', 'dataset.nt', 'urn:default-graph');
rdf_loader_run();
checkpoint;
EOF
echo ">>> Dataset has been loaded, stopping temporary server"
kill -TERM $pid

# Modify virtuoso port to final one, and default settings to ensure correct results
sed -i "s/8890/8891/g" /database/virtuoso.ini
sed -i "s/ResultSetMaxRows           = 10000/ResultSetMaxRows           = 10000000/g" /database/virtuoso.ini
sed -i "s/MaxConstructTriples        = 10000/MaxConstructTriples        = 10000000/g" /database/virtuoso.ini
sed -i "s/MaxQueryExecutionTime      = 60/MaxQueryExecutionTime      = 600000/g" /database/virtuoso.ini
cat /database/virtuoso.ini

# Start server on actual port
echo ">>> Starting final server"
/virtuoso-entrypoint.sh start
