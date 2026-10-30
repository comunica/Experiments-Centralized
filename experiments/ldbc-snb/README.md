# LDBC SNB Experiment

This experiment was created with [jbr](https://github.com/rubensworks/jbr.js).

It runs the [LDBC Social Network Benchmark (SNB)](https://ldbcouncil.org/benchmarks/snb/) Interactive workload
(short queries IS1-7 and complex queries IC1-14) at scale factor 0.1,
using the same query set and seed as Comunica's continuous performance benchmark.
Queries are cut off client-side after 300 seconds.
Generating the dataset requires Docker, and runs a Hadoop-based datagen with 4 GB of memory.

## Requirements

* [Node.js](https://nodejs.org/en/) _(1.12 or higher)_

## Installation

Before this experiment can be used, its dependencies must be downloaded first:

```bash
$ npm install
```

## Usage

Generate the dataset and queries:

```bash
$ npm run jbr -- prepare
```

Run the experiment locally:

```bash
$ npm run jbr -- run
```

The `output/` directory will now contain all experiment results.

## Usage if jbr is installed globally

If [jbr is installed globally](https://github.com/rubensworks/jbr.js/tree/master/packages/jbr#installation),
you can prepare and run this experiment as follows:

```bash
$ jbr prepare
$ jbr run
```
