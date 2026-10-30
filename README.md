# Comunica Centralized Experiments

This repo contains several experiments to compare the performance of Comunica when run in a centralized setting.

Please refer to the README within each `experiments/*` directory on how to run these experiments.
The latest results of these experiments can be found in `results/`.
These results are discussed on https://comunica.dev/performance/.

## Query timeouts

All engines stop evaluating a query after 300 seconds, so that a timed-out query does not keep using the CPU while the next queries are measured.
This is needed because most engines keep evaluating a query after its client disconnects.

| Engine | Setting |
|---|---|
| Comunica | `queryTimeout` of the hook (this also applies to the preload query, so it must exceed the time needed to load the dataset) |
| Oxigraph | `--timeout-s` in `Dockerfile-oxigraph` |
| Jena | `--timeout` in `jena.sh` |
| Blazegraph | `maxQueryTimeMillis` in its endpoint URL |
| GraphDB | the repository's `queryTimeout` in `graphdb.sh`, with `throwQueryEvaluationExceptionOnTimeout` so that it fails instead of returning partial results |
| QLever | `TIMEOUT` in the `Qleverfile` (otherwise QLever defaults to 30 seconds) |
| Virtuoso | none: its timeouts return partial results, but it does stop evaluating once the client disconnects |

Oxigraph JS and Quadstore evaluate queries in-process without timeout support.
