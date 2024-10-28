#!/bin/sh

# Load dataset
$FUSEKI_HOME/tdbloader2 $TDBLOADER_OPTS --loader=parallel --loc=$FUSEKI_BASE/databases/mydataset /staging/dataset.nt

# Start server on port 3030
./fuseki-server --tdb2 --port 3000 --loc=$FUSEKI_BASE/databases/mydataset /mydataset
