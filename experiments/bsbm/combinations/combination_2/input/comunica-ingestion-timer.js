// Prints the time Comunica takes to load its dataset as "JBR_INGESTION_TIME_S <seconds>", like the other engines' startup scripts.
// It counts from opening the dataset until it can be queried: reading, parsing, metadata extraction and building the in-memory
// store for an RDF file, or opening an HDT file and its index. Building the engine, the warm-up queries and evaluating the query
// that triggered the load are not counted.
// It also prints the size of the loaded dataset as "JBR_STORE_SIZE_BYTES <bytes> <memory|disk>": for an RDF file, the used heap
// and external memory after loading minus before, both after garbage collection; for an HDT file, the size of the file and its index.
// Loaded with `node --require`, so it works with Comunica's published images; only the first load is reported.
const fs = require('node:fs');
const v8 = require('node:v8');
const vm = require('node:vm');

const root = process.cwd();
let starting;
let start;
let memoryBefore;
let reported = false;

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

// The live memory, after collecting three times with pauses in between, as V8 releases array buffer memory
// asynchronously: after a bulk load, two collections still leave tens of MiB of released buffers counted.
async function liveMemory() {
  for (let i = 0; i < 3; i++) {
    gc();
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  const { heapUsed, external } = process.memoryUsage();
  return heapUsed + external;
}

// Called when opening the dataset, so the memory is measured before the timer starts
function begin(measureMemory) {
  starting ??= (async() => {
    if (measureMemory) {
      memoryBefore = await liveMemory();
    }
    start = process.hrtime.bigint();
  })();
  return starting;
}

function reportTime() {
  if (reported || start === undefined) {
    return false;
  }
  reported = true;
  process.stderr.write(`JBR_INGESTION_TIME_S ${(Number(process.hrtime.bigint() - start) / 1e9).toFixed(3)}\n`);
  return true;
}

function reportStoreSize(bytes, kind) {
  process.stderr.write(`JBR_STORE_SIZE_BYTES ${bytes} ${kind}\n`);
}

function load(name) {
  try {
    return require(require.resolve(name, { paths: [ root ] }));
  } catch {
    return undefined;
  }
}

// RDF files: from opening the file until its quads are in the in-memory store
const dereferenceFile = load('@comunica/actor-dereference-file');
const identifyFile = load('@comunica/actor-query-source-identify-hypermedia-none');
if (dereferenceFile && identifyFile) {
  const { ActorDereferenceFile } = dereferenceFile;
  const run = ActorDereferenceFile.prototype.run;
  ActorDereferenceFile.prototype.run = async function (...args) {
    await begin(true);
    return run.apply(this, args);
  };
  const { ActorQuerySourceIdentifyHypermediaNone } = identifyFile;
  const storeStream = ActorQuerySourceIdentifyHypermediaNone.storeStream;
  ActorQuerySourceIdentifyHypermediaNone.storeStream = async function (...args) {
    const store = await storeStream.apply(this, args);
    if (reportTime()) {
      // The store is still referenced here, so it is part of the live memory
      reportStoreSize((await liveMemory()) - memoryBefore, 'memory');
    }
    return store;
  };
}

// HDT files: opening the file and its index
const identifyHdt = load('@comunica/actor-query-source-identify-hdt');
if (identifyHdt) {
  const { ActorQuerySourceIdentifyHdt } = identifyHdt;
  const run = ActorQuerySourceIdentifyHdt.prototype.run;
  ActorQuerySourceIdentifyHdt.prototype.run = async function (action, ...args) {
    await begin(false);
    const result = await run.call(this, action, ...args);
    if (reportTime()) {
      const file = action.querySourceUnidentified.value;
      const size = [ file, `${file}.index.v1-1` ]
        .filter(path => fs.existsSync(path))
        .reduce((sum, path) => sum + fs.statSync(path).size, 0);
      reportStoreSize(size, 'disk');
    }
    return result;
  };
}
