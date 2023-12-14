import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { IncomingMessage, RequestListener, Server as HttpServer, ServerResponse, request as httpRequest } from "http";
import { Server as HttpsServer, request as httpsRequest } from "https";
import { randomUUID } from "crypto";
import { inspect } from "util";
import { createBrotliDecompress, createGunzip } from "zlib";

import { WebSocket, WebSocketServer, createWebSocketStream } from "ws";
import { createCounter } from "./countSize.ts";

await mkdir('logs', { recursive: true });

const getCleanHeader = (clientReq: IncomingMessage) => {
    const headers = Object.fromEntries(
        [ ...new Array(clientReq.rawHeaders.length / 2) ]
            .map((_, i) => [ clientReq.rawHeaders[ i * 2 ], clientReq.rawHeaders[ i * 2 + 1 ] ])
    );
    if ('Proxy-Connection' in headers) {
        headers[ 'Connection' ] = headers[ 'Proxy-Connection' ];
        delete headers[ 'Proxy-Connection' ];
    }
    return headers;
};


const logTimeline = createWriteStream(`logs/log.timeline`, 'utf8');

logTimeline.write('requestId, url, reqStartAt, reqEndAt, resStartAt, reqEndAt, reqSize, resSize, status');

export const requestListener: (https: boolean) => RequestListener<typeof IncomingMessage, typeof ServerResponse> = (https: boolean) => async (clientReq, clientRes) => {
    console.log(`proxy: ${https ? 'https' : 'http'} accessed`);

    const headers = getCleanHeader(clientReq);

    const url = new URL(clientReq.url ?? '', (https ? 'https://' : 'http://') + clientReq.headers.host);
    const requestId = url.toString().replaceAll('://', '-').replaceAll('/', '-').slice(0, 150) + '-' + new Date().toISOString() + '-' + randomUUID();

    await mkdir(`logs/${requestId}/`);

    const requestMetaWriteStream = createWriteStream(`logs/${requestId}/req.metadata`, 'utf8');
    const requestDataWriteStream = createWriteStream(`logs/${requestId}/req.data`);


    requestMetaWriteStream.write(url.toString() + '\n');
    requestMetaWriteStream.write(clientReq.method + '\n');
    requestMetaWriteStream.write(clientReq.url + '\n');
    requestMetaWriteStream.write('\n');
    requestMetaWriteStream.write(clientReq.rawHeaders.join('\n') + '\n');
    requestMetaWriteStream.write('\n');



    const responseMetaWriteStream = createWriteStream(`logs/${requestId}/res.metadata`, 'utf8');
    const responseDataWriteStream = createWriteStream(`logs/${requestId}/res.data`);

    const serverReq = (https ? httpsRequest : httpRequest)(url.toString(), {
        method: clientReq.method,
        headers
    }, serverRes => {
        clientRes.writeHead(serverRes.statusCode ?? 204, serverRes.rawHeaders);

        responseMetaWriteStream.write(serverRes.statusCode + '\n');
        responseMetaWriteStream.write('\n');
        responseMetaWriteStream.write(serverRes.rawHeaders.join('\n') + '\n');
        responseMetaWriteStream.write('\n');

        serverRes.pipe(clientRes);
        serverRes.pipe(responseDataWriteStream);

        const { promise: resSizeCountPromise, stream: resSizeCounter } = createCounter();
        serverRes.pipe(resSizeCounter);
        Promise.all([
            resSizeCountPromise.then(size => {
                responseMetaWriteStream.write('size: ' + size + ' B\n');
                return size;
            }),
            new Promise<number>(resolve => {
                serverRes.on('end', () => {
                    const date = Date.now();
                    responseMetaWriteStream.write('end at:' + date + '\n');
                    resolve(date);
                });
            })
        ]).then(([]) => {
            logTimeline.write('');
            responseMetaWriteStream.end();
        });


        if (serverRes.headers[ "content-encoding" ] === 'gzip') {
            const responseGunzipDataWriteStream = createWriteStream(`logs/${requestId}/res.data.gunzip`);
            const gunzip = createGunzip();
            serverRes.pipe(gunzip).pipe(responseGunzipDataWriteStream);
        } else if (serverRes.headers[ "content-encoding" ] === 'br') {
            const responseUnBrotliDataWriteStream = createWriteStream(`logs/${requestId}/res.data.debr`);
            const unBrotli = createBrotliDecompress();
            serverRes.pipe(unBrotli).pipe(responseUnBrotliDataWriteStream);
        }
    });
    clientReq.pipe(serverReq);
    clientReq.pipe(requestDataWriteStream);

    const { promise: reqSizeCountPromise, stream: reqSizeCounter } = createCounter();
    clientReq.pipe(reqSizeCounter);

    Promise.all([
        reqSizeCountPromise.then(size => {
            requestMetaWriteStream.write('size: ' + size + ' B\n');
        }),
        new Promise<void>(resolve => {
            clientReq.on('end', () => {
                requestMetaWriteStream.write('end at: ' + Date.now() + '\n');
                resolve();
            });
        })
    ]).then(() => {
        requestMetaWriteStream.end();
    });

    clientReq.on('error', (err) => {
        const obj: { stack?: any; } = {};
        Error.captureStackTrace(obj);
        responseMetaWriteStream.write(inspect(obj.stack));
        requestMetaWriteStream.write(inspect(err));
        requestMetaWriteStream.write('\n');
    });
    serverReq.on('error', (err) => {
        const obj: { stack?: any; } = {};
        Error.captureStackTrace(obj);
        responseMetaWriteStream.write(inspect(obj.stack));
        responseMetaWriteStream.write(inspect(err));
        responseMetaWriteStream.write('\n');
    });
};

export const websocketServer = (server: HttpServer | HttpsServer, https: boolean) => {
    const websocketServer = new WebSocketServer({ server: server });
    websocketServer.on('connection', async (websocketClient, clientReq) => {
        console.log(`proxy: ${https ? 'https' : 'http'} ws accessed`);

        const url = `${https ? 'wss' : 'ws'}://${clientReq.url ?? '/'}`;

        const requestId = url.toString().replaceAll('://', '-').replaceAll('/', '-').slice(0, 150) + '-' + new Date().toISOString() + '-' + randomUUID();
        await mkdir(`logs/${requestId}/`);

        const headers = getCleanHeader(clientReq);
        const serverWebSocket = new WebSocket(url, {
            headers,
        });

        serverWebSocket.on('close', () => {
            websocketClient.readyState === 1 && websocketClient.close();
        });
        serverWebSocket.on('error', (err) => {
            const obj: { stack?: any; } = {};
            Error.captureStackTrace(obj);
            console.log(obj.stack);
            console.error(err);
            websocketClient.readyState === 1 && websocketClient.close();
            serverWebSocket.readyState === 1 && serverWebSocket.close();
        });
        websocketClient.on('close', () => {
            serverWebSocket.readyState === 1 && serverWebSocket.close();
        });
        websocketClient.on('error', (err) => {
            const obj: { stack?: any; } = {};
            Error.captureStackTrace(obj);
            console.log(obj.stack);
            console.error(err);
            websocketClient.readyState === 1 && websocketClient.close();
            serverWebSocket.readyState === 1 && serverWebSocket.close();
        });

        const serverDuplex = createWebSocketStream(serverWebSocket, { encoding: 'utf8' });
        const clientDuplex = createWebSocketStream(websocketClient, { encoding: 'utf8' });
        serverDuplex.pipe(clientDuplex);
        clientDuplex.pipe(serverDuplex);


        const requestMetaWriteStream = createWriteStream(`logs/${requestId}/req.metadata`, 'utf8');
        const requestDataWriteStream = createWriteStream(`logs/${requestId}/req.data`);
        const responseDataWriteStream = createWriteStream(`logs/${requestId}/res.data`);

        requestMetaWriteStream.write(url.toString() + '\n');
        requestMetaWriteStream.write(clientReq.method + '\n');
        requestMetaWriteStream.write(clientReq.url + '\n');
        requestMetaWriteStream.write('\n');
        requestMetaWriteStream.write(clientReq.rawHeaders.join('\n') + '\n');
        requestMetaWriteStream.write('\n');

        clientDuplex.pipe(requestDataWriteStream);
        serverDuplex.pipe(responseDataWriteStream);
    });
    websocketServer.on('error', (err) => {
        const obj: { stack?: any; } = {};
        Error.captureStackTrace(obj);
        console.log(obj.stack);
        console.error(err);
    });
};
