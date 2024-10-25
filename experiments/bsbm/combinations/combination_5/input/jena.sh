#!/bin/sh

# Start server on port 4000
#./fuseki-server --tdb2 --port 4000 --loc=$FUSEKI_BASE/databases/mydataset &
#pid=$!

# Wait until server is up
#echo "Waiting for Fuseki to finish starting up..."
#until $(curl --output /dev/null --silent --head --fail http://localhost:4000); do
#  sleep 1s
#done

# Load dataset
$FUSEKI_HOME/tdbloader2 $TDBLOADER_OPTS --loader=parallel --loc=$FUSEKI_BASE/databases/mydataset /staging/dataset.nt

# Stop server
#kill $pid

# Start server on port 3030
./fuseki-server --tdb2 --port 3000 --loc=$FUSEKI_BASE/databases/mydataset /mydataset
