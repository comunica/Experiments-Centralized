# Comunica Centralized Experiments

This repo contains several experiments to compare the performance of Comunica when run in a centralized setting.

Please refer to the README within each `experiments/*` directory on how to run these experiments.
The latest results of these experiments can be found in `results/`.
These results are discussed on https://comunica.dev/performance/.

## In-memory stores

Oxigraph and Jena are also run with an in-memory store, as the combinations `oxigraph-memory` and `jena-memory`, next to their default disk-based stores (`oxigraph` and the TDB2-based `jena`).

* `oxigraph-memory` runs the same server and flags without a storage location. It loads the dataset over HTTP after starting, and then adds a marker triple to the named graph `urn:jbr:ready`, which the readiness check polls. As the server uses `--union-default-graph`, a query pattern that matches any triple also matches this marker; none of the benchmark queries do.
* `jena-memory` runs Fuseki with an in-memory dataset loaded from the dataset file at startup. It uses an 8 GB heap by default (the TDB2-based `jena` keeps Fuseki's default of 4 GB), which can be changed with `JVM_ARGS` in `jena-memory.sh`. Its ingestion time includes the server startup.

## Interactive report

`scripts/report.js` turns the results into one self-contained HTML page: per experiment, a sortable table of all engines (geometric mean, time relative to Comunica-Memory, failed queries, startup and ingestion times), a per-template chart with the fastest and slowest execution of every template, and, when an experiment was run at several dataset scales, a chart of how each engine compares to Comunica-Memory across those scales.
It needs no dependencies beyond Node.js, and the page loads nothing from the network.

After running the experiments:

```bash
$ node scripts/report.js experiments
```

This reads `combinations/*/output` of every experiment in `experiments/` and writes `report.html`.
Inputs can also be single experiment directories (`experiments/watdiv`), and `--output`, `--title` and `--reference` (the combination to compare with) can be changed; `--help` lists all options.

To compare dataset scales, save the results of each scale before running the next one:

```bash
$ node scripts/report.js --save-data results/data-small.json experiments
# Change the scale in each experiment's jbr-experiment.json.template (datasetScale for WatDiv, productCount for BSBM, scale for LDBC SNB),
# then regenerate the combinations, the data and the results in each experiment directory:
#   npm run jbr -- generate-combinations && npm run jbr -- prepare -f && npm run jbr -- run
$ node scripts/report.js --save-data results/data-large.json experiments
$ node scripts/report.js --output results/report.html results/data-small.json results/data-large.json
```

The scale of every run is read from its experiment configuration, so each saved file can hold several experiments, and runs of the same experiment at the same scale from later inputs replace earlier ones.
Combinations without results (for example when a run was stopped) are listed as such.

## Query timeouts

All engines stop evaluating a query after 300 seconds, so that a timed-out query does not keep using the CPU while the next queries are measured.
This is needed because most engines keep evaluating a query after its client disconnects.

| Engine | Setting |
|---|---|
| Comunica | `queryTimeout` of the hook (this also applies to the preload query, so it must exceed the time needed to load the dataset) |
| Oxigraph | `--timeout-s` in `Dockerfile-oxigraph` and `Dockerfile-oxigraph-memory` |
| Jena | `--timeout` in `jena.sh` and `jena-memory.sh` |
| Blazegraph | `maxQueryTimeMillis` in its endpoint URL |
| GraphDB | the repository's `queryTimeout` in `graphdb.sh`, with `throwQueryEvaluationExceptionOnTimeout` so that it fails instead of returning partial results |
| QLever | `TIMEOUT` in the `Qleverfile` (otherwise QLever defaults to 30 seconds) |
| Virtuoso | none: its timeouts return partial results, but it does stop evaluating once the client disconnects |

Oxigraph JS and Quadstore evaluate queries in-process without timeout support.
