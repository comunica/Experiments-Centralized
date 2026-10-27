# Comunica Centralized Experiments

This repo contains several experiments to compare the performance of Comunica when run in a centralized setting.

Please refer to the README within each `experiments/*` directory on how to run these experiments.
The latest results of these experiments can be found in `results/`.
These results are discussed on https://comunica.dev/performance/.

## Load and ingestion times

Besides query execution times, each experiment run records how long each endpoint takes to start:

* **Load time** (`combinations/combination_*/output/logs/load-time.csv`, written by jbr): time from starting the endpoint until it is available for queries.
* **Ingestion time**: the part of the load time spent on loading the dataset. Each engine's startup script prints it to its log as a `JBR_INGESTION_TIME_S <seconds>` line, measured around only its loading step. For Comunica, it is the duration of the ASK query sent by the hook on startup (`sparql-endpoint-comunica-preload-time.csv`), enabled via its `preloadQuery` option.

After running an experiment, `npm run plot-load` summarizes these into `plot_load_times.csv` and `plot_load_times.svg`.

Notes:

* The load time is measured by polling the endpoint every second, so it has a resolution of about one second.
* For engines that load data via a temporary server (Blazegraph, Virtuoso, GraphDB), the load time includes two server startups.
* For Comunica HDT, the HDT conversion happens once while preparing the experiment, and is not included.
