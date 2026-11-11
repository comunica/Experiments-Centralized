// Prints the time Comunica takes to load its dataset as "JBR_INGESTION_TIME_S <seconds>", like the other engines' startup scripts.
// It counts from opening the dataset until it can be queried: reading, parsing, metadata extraction and building the in-memory
// store for an RDF file, or opening an HDT file and its index. Building the engine, the warm-up queries and evaluating the query
// that triggered the load are not counted.
// Loaded with `node --require`, so it works with Comunica's published images; only the first load is reported.
const root = process.cwd();
let start;
let reported = false;

function report() {
  if (!reported && start !== undefined) {
    reported = true;
    process.stderr.write(`JBR_INGESTION_TIME_S ${(Number(process.hrtime.bigint() - start) / 1e9).toFixed(3)}\n`);
  }
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
  ActorDereferenceFile.prototype.run = function (...args) {
    start ??= process.hrtime.bigint();
    return run.apply(this, args);
  };
  const { ActorQuerySourceIdentifyHypermediaNone } = identifyFile;
  const storeStream = ActorQuerySourceIdentifyHypermediaNone.storeStream;
  ActorQuerySourceIdentifyHypermediaNone.storeStream = async function (...args) {
    const store = await storeStream.apply(this, args);
    report();
    return store;
  };
}

// HDT files: opening the file and its index
const identifyHdt = load('@comunica/actor-query-source-identify-hdt');
if (identifyHdt) {
  const { ActorQuerySourceIdentifyHdt } = identifyHdt;
  const run = ActorQuerySourceIdentifyHdt.prototype.run;
  ActorQuerySourceIdentifyHdt.prototype.run = async function (...args) {
    start ??= process.hrtime.bigint();
    const result = await run.apply(this, args);
    report();
    return result;
  };
}
