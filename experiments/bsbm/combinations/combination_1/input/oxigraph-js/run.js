const http = require('node:http');
const { Readable } = require('node:stream');
const oxigraph = require('oxigraph');
const { rdfParser } = require('rdf-parse');
const fs = require('node:fs');
const url = require("url");
const querystring = require("querystring");
const { QueryEngine } = require("@comunica/query-sparql");
const { DataFactory } = require("rdf-data-factory");
const { BindingsFactory } = require("@comunica/utils-bindings-factory");
const store = new oxigraph.Store();
const comunicaEngine = new QueryEngine();
const DF = new DataFactory();
const BF = new BindingsFactory(DF);

const rdfjs = process.argv[3] === 'rdfjs';

function loadDataset() {
    return new Promise((resolve, reject) => {
        // console.time('import');
        // const input = rdfParser.parse(
        //     fs.createReadStream(process.argv[2]),
        //     { contentType: 'application/n-triples' },
        // );
        // input.on('data', (q) => store.add(q));
        // input.on('error', reject);
        // input.on('end', () => {
        //     console.timeEnd('import');
        //     resolve();
        // });

        console.time('import');
        const data = fs.readFileSync(process.argv[2], 'utf-8');
        store.load(data, { format: 'application/n-triples' });
        console.timeEnd('import');
        resolve();
    });
}

async function start() {
    // Load dataset
    await loadDataset();

    http.createServer(async function (req, res) {
        const requestUrl = url.parse(req.url ?? '', true);
        let query = requestUrl.query.query;

        if (!query && (requestUrl.pathname === '/sparql' || requestUrl.pathname === '/query') && req.headers['content-type']) {
            query = (await parseBody(req)).value;
        }

        if (!query) {
            console.log('GOT REQUEST TO /');
            res.writeHead(200, { 'content-type': 'text', 'Access-Control-Allow-Origin': '*' });
            res.write('OK');
            res.end();
            return;
        }

        // const { value: query } = await parseBody(req);
        console.log('GOT QUERY ' + query);
        // const mediaType = (req.headers['accept'].slice(0, Math.min(req.headers['accept'].indexOf(';') + 1), req.headers['accept'].indexOf(',') + 1)) || req.headers['accept'];
        const sliceIdx = Math.min(req.headers['accept'].indexOf(';'), req.headers['accept'].indexOf(','));
        let mediaType = sliceIdx >= 0 ? req.headers['accept'].slice(0, sliceIdx) : req.headers['accept'];
        console.log('GOT ACCEPT HEADER ' + req.headers['accept']); // TODO
        console.log('GOT MEDIA TYPE ' + mediaType); // TODO

        if (rdfjs) {
            const select = query.includes('SELECT');
            const oxiResult = store.query(query, { use_default_graph_as_union: true });
            res.writeHead(200, { 'content-type': mediaType, 'Access-Control-Allow-Origin': '*' });
            console.log(oxiResult); // TODO
            let data;

            if (select) {
                // Convert to proper bindings objects
                const bindings = [];
                for (const bindingsMap of oxiResult) {
                    const record = {};
                    for (let [ key, value ] of bindingsMap) {
                        record[key] = value;
                    }
                    console.log(record); // TODO
                    bindings.push(BF.fromRecord(record));
                }

                data = (await comunicaEngine.resultToString({
                    resultType: 'bindings',
                    execute: () => Readable.from(bindings),
                    metadata: () => ({ variables: []}),
                }, mediaType)).data;
            } else {
                // Handle as quads
                mediaType = 'text/turtle';
                data = (await comunicaEngine.resultToString({
                    resultType: 'quads',
                    execute: () => Readable.from(oxiResult),
                    metadata: () => ({}),
                }, mediaType)).data;
            }

            data.on('error', (error) => {
                stdout.write(`[500] Server error in results: ${error.message} \n`);
                if (!response.writableEnded) {
                    response.end('An internal server error occurred.\n');
                }
            });
            data.pipe(res);
        } else {
            const response = store.query(query, { use_default_graph_as_union: true, results_format: mediaType });
            res.writeHead(200, { 'content-type': mediaType, 'Access-Control-Allow-Origin': '*' });
            res.write(response);
            res.end();
        }
    }).listen(3000);
}

start();

function parseBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('error', reject);
        request.on('data', (chunk) => {
            body += chunk;
        });
        request.on('end', () => {
            const contentType = request.headers['content-type'];
            if (contentType) {
                if (contentType.includes('application/sparql-query')) {
                    return resolve({type: 'query', value: body, context: undefined});
                }
                if (contentType.includes('application/sparql-update')) {
                    return resolve({type: 'void', value: body, context: undefined});
                }
                if (contentType.includes('application/x-www-form-urlencoded')) {
                    const bodyStructure = querystring.parse(body);
                    let context;
                    if (bodyStructure.context) {
                        try {
                            context = JSON.parse(bodyStructure.context);
                        } catch (error) {
                            reject(new Error(`Invalid POST body with context received ('${(bodyStructure).context}'): ${(
                                error).message}`));
                        }
                    }
                    if (bodyStructure.query) {
                        return resolve({type: 'query', value: bodyStructure.query, context});
                    }
                    if (bodyStructure.update) {
                        return resolve({type: 'void', value: bodyStructure.update, context});
                    }
                }
            }
            reject(new Error(`Invalid POST body received with content type "${contentType}", query type could not be determined`));
        });
    });
}
