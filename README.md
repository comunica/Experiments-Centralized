# Comunica Centralized Experiments

This repo contains several experiments to compare the performance of Comunica when run in a centralized setting.

Please refer to the README within each `experiments/*` directory on how to run these experiments.
The latest results of these experiments can be found in `results/`.
These results are discussed on https://comunica.dev/performance/.

## In-memory stores

Oxigraph and Jena are also run with an in-memory store, as the combinations `oxigraph-memory` and `jena-memory`, next to their default disk-based stores (`oxigraph` and the TDB2-based `jena`).

* `oxigraph-memory` runs the same server and flags without a storage location. It loads the dataset over HTTP after starting, and then adds a marker triple to the named graph `urn:jbr:ready`, which the readiness check polls. As the server uses `--union-default-graph`, a query pattern that matches any triple also matches this marker; none of the benchmark queries do.
* `jena-memory` runs Fuseki with an in-memory dataset loaded from the dataset file at startup. It uses an 8 GB heap by default (the TDB2-based `jena` keeps Fuseki's default of 4 GB), which can be changed with `JVM_ARGS` in `jena-memory.sh`. Its ingestion time includes the server startup.

## Ingestion time and store size

Each engine prints how long it takes to load the dataset, as `JBR_INGESTION_TIME_S <seconds>`, and how large the loaded dataset is, as `JBR_STORE_SIZE_BYTES <bytes> <memory|disk>`.
`node scripts/load-times.js experiments/<experiment>` collects both from the logs of a run into `plot_load_times.csv`, and plots them in `plot_load_times.svg` and `plot_load_times_store_size.svg`.

The store size is what the loaded dataset takes where the engine keeps it, so it is in memory for in-memory engines and on disk for the others. On disk, it is the space allocated to the engine's files rather than their apparent size, as several engines preallocate their files:

| Engine | Store size |
|---|---|
| `comunica-memory` | Used heap and external memory after loading minus before, both after garbage collection (`comunica-ingestion-timer.js`) |
| `oxigraph-memory` | Growth of the server's resident memory while loading |
| `jena-memory` | Live heap after loading minus that of a server with an empty dataset, both after a full garbage collection (`jcmd GC.class_histogram`) |
| `comunica-hdt` | HDT file and its index (the HDT file is created in `jbr prepare`) |
| `oxigraph` | RocksDB directory, right after loading |
| `jena` | TDB2 database directory, whose files TDB2 preallocates sparsely in blocks of 8 MB |
| `blazegraph` | Journal file, which is preallocated with an initial extent of 200 MB, so small datasets take at least that |
| `virtuoso` | Pages in use in `virtuoso.db` after a checkpoint, as the file itself is preallocated |
| `graphdb` | Repository directory |
| `qlever` | Index files |

Memory and disk sizes are not directly comparable: on disk, engines can use compression and formats that are slower to read.

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
