#!/bin/sh
# Inspired by https://github.com/Ontotext-AD/graphdb-docker/blob/master/Dockerfile

# Start temporary server on a different port
/opt/graphdb/dist/bin/graphdb -Dgraphdb.connector.port=7201 &
pid=$!

# Wait until server is up
echo ">>> Waiting for GraphDB to finish starting up..."
until $(curl --output /dev/null --silent --head --fail http://localhost:7201/rest/repositories); do
  sleep 1s
done

# Load dataset
echo ">>> Loading dataset..."
curl -X PUT http://localhost:7201/rest/repositories/experiment -H 'Accept: application/json' -H 'Content-Type: application/json' -d '
    {
        "id": "experiment",
        "title": "experiment",
        "type": "graphdb",
        "sesameType":"graphdb:SailRepository",
        "params":{
            "queryTimeout":{
                "name":"queryTimeout",
                "label":"Query timeout (seconds)",
                "value":"0"
            },
            "cacheSelectNodes":{
                "name":"cacheSelectNodes",
                "label":"Cache select nodes",
                "value":"true"
            },
            "rdfsSubClassReasoning":{
                "name":"rdfsSubClassReasoning",
                "label":"RDFS subClass reasoning",
                "value":"false"
            },
            "validationEnabled":{
                "name":"validationEnabled",
                "label":"Enable the SHACL validation",
                "value":"true"
            },
            "ftsStringLiteralsIndex":{
                "name":"ftsStringLiteralsIndex",
                "label":"FTS index for xsd:string literals",
                "value":"default"
            },
            "shapesGraph":{
                "name":"shapesGraph",
                "label":"Named graphs for SHACL shapes",
                "value":"http://rdf4j.org/schema/rdf4j#SHACLShapeGraph"
            },
            "parallelValidation":{
                "name":"parallelValidation",
                "label":"Run parallel validation",
                "value":"true"
            },
            "checkForInconsistencies":{
                "name":"checkForInconsistencies",
                "label":"Enable consistency checks",
                "value":"false"
            },
            "performanceLogging":{
                "name":"performanceLogging",
                "label":"Log the execution time per shape",
                "value":"false"
            },
            "disableSameAs":{
                "name":"disableSameAs",
                "label":"Disable owl:sameAs",
                "value":"true"
            },
            "ftsIrisIndex":{
                "name":"ftsIrisIndex",
                "label":"FTS index for full-text indexing of IRIs",
                "value":"en"
            },
            "entityIndexSize":{
                "name":"entityIndexSize",
                "label":"Entity index size",
                "value":"10000000"
            },
            "dashDataShapes":{
                "name":"dashDataShapes",
                "label":"DASH data shapes extensions",
                "value":"true"
            },
            "queryLimitResults":{
                "name":"queryLimitResults",
                "label":"Limit query results",
                "value":"0"
            },
            "throwQueryEvaluationExceptionOnTimeout":{
                "name":"throwQueryEvaluationExceptionOnTimeout",
                "label":"Throw exception on query timeout",
                "value":"false"
            },
            "member":{
                "name":"member",
                "label":"FedX repo members",
                "value":[]
            },
            "storageFolder":{
                "name":"storageFolder",
                "label":"Storage folder",
                "value":"storage"
            },
            "validationResultsLimitPerConstraint":{
                "name":"validationResultsLimitPerConstraint",
                "label":"Validation results limit per constraint",
                "value":"1000"
            },
            "enablePredicateList":{
                "name":"enablePredicateList",
                "label":"Enable predicate list index",
                "value":"true"
            },
            "transactionalValidationLimit":{
                "name":"transactionalValidationLimit",
                "label":"Transactional validation limit",
                "value":"500000"
            },
            "ftsIndexes":{
                "name":"ftsIndexes",
                "label":"FTS indexes to build (comma delimited)",
                "value":"default, iri, en"
            },
            "logValidationPlans":{
                "name":"logValidationPlans",
                "label":"Log the executed validation plans",
                "value":"false"
            },
            "imports":{
                "name":"imports",
                "label":"Imported RDF files('\'';'\'' delimited)",
                "value":""
            },
            "isShacl":{
                "name":"isShacl",
                "label":"Enable SHACL validation",
                "value":"false"
            },
            "inMemoryLiteralProperties":{
                "name":"inMemoryLiteralProperties",
                "label":"Cache literal language tags",
                "value":"true"
            },
            "ruleset":{
                "name":"ruleset",
                "label":"Ruleset",
                "value":"rdfsplus-optimized"
            },
            "readOnly":{
                "name":"readOnly",
                "label":"Read-only",
                "value":"false"
            },
            "enableLiteralIndex":{
                "name":"enableLiteralIndex",
                "label":"Enable literal index",
                "value":"false"
            },
            "enableFtsIndex":{
                "name":"enableFtsIndex",
                "label":"Enable full-text search (FTS) index",
                "value":"false"
            },
            "defaultNS":{
                "name":"defaultNS",
                "label":"Default namespaces for imports('\'';'\'' delimited)",
                "value":""
            },
            "enableContextIndex":{
                "name":"enableContextIndex",
                "label":"Enable context index",
                "value":"false"
            },
            "baseURL":{
                "name":"baseURL",
                "label":"Base URL",
                "value":"http://example.org/owlim#"
            },
            "logValidationViolations":{
                "name":"logValidationViolations",
                "label":"Log validation violations",
                "value":"false"
            },
            "globalLogValidationExecution":{
                "name":"globalLogValidationExecution",
                "label":"Log every execution step of the SHACL validation",
                "value":"false"
            },
            "entityIdSize":{
                "name":"entityIdSize",
                "label":"Entity ID size",
                "value":"32"
            },
            "repositoryType":{
                "name":"repositoryType",
                "label":"Repository type",
                "value":"file-repository"
            },
            "eclipseRdf4jShaclExtensions":{
                "name":"eclipseRdf4jShaclExtensions",
                "label":"RDF4J SHACL extensions",
                "value":"true"
            },
            "validationResultsLimitTotal":{
                "name":"validationResultsLimitTotal",
                "label":"Validation results limit total",
                "value":"1000000"}
            }
        }
    }'
curl -X POST \
  --data-binary @/staging/dataset.nt \
  --header 'Content-Type:application/n-triples' \
  http://localhost:7201/repositories/experiment/statements
echo ">>> Dataset has been loaded, stopping temporary server"
kill -TERM $pid

# Start server on actual port
echo ">>> Starting final server"
/opt/graphdb/dist/bin/graphdb
