const { Quadstore } = require('quadstore');
const { ClassicLevel } = require('classic-level');
const fs = require('node:fs');
const { QueryEngine } = require("@comunica/query-sparql");
const { DataFactory } = require("rdf-data-factory");
const { StreamParser } = require('n3');
const http = require('node:http');
const url = require("url");
const querystring = require("querystring");

const engine = new QueryEngine();
const DF = new DataFactory();

function loadDataset() {
    return new Promise(async (resolve, reject) => {
        console.time('import');
        const store = new Quadstore({
            backend: new ClassicLevel('./store.db'),
            dataFactory: DF,
        });
        await store.open();

        const data = fs.createReadStream(process.argv[2], 'utf-8');
        await store.putStream(data.pipe(new StreamParser({ format: 'application/n-triples' })), { batchSize: 100 });
        console.timeEnd('import');
        resolve(store);
    });
}

async function start() {
    // Load dataset
    const store = await loadDataset();

    // Start server
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
        const sliceIdx = Math.min(req.headers['accept'].indexOf(';'), req.headers['accept'].indexOf(','));
        let mediaType = sliceIdx >= 0 ? req.headers['accept'].slice(0, sliceIdx) : req.headers['accept'];
        console.log('GOT ACCEPT HEADER ' + req.headers['accept']); // TODO
        console.log('GOT MEDIA TYPE ' + mediaType); // TODO

        const select = query.includes('SELECT');
        const result = await engine.query(query, { sources: [ store ] });
        res.writeHead(200, { 'content-type': mediaType, 'Access-Control-Allow-Origin': '*' });
        if (!select) {
            // Handle as quads
            mediaType = 'text/turtle';
        }
        const data = (await engine.resultToString(result, mediaType)).data;

        data.on('error', (error) => {
            stdout.write(`[500] Server error in results: ${error.message} \n`);
            if (!res.writableEnded) {
                res.end('An internal server error occurred.\n');
            }
        });
        data.pipe(res);
    }).listen(3000);

    // await store.close();
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
