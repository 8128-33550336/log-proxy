import { createServer } from "http";
import { connect } from "net";

import { requestListener, websocketServer } from "./common.ts";

export const start = () => {

    const server = createServer({
        requestTimeout: 0
    }, requestListener(false));

    server.on('connect', async (_, clientSocket, clientHead) => {
        console.log('proxy: connected');
        // https
        const serverSocket = connect('./https.sock', () => {
            clientSocket.write('HTTP/1.0 200 Connection established\r\n\r\n');
            if (clientHead && clientHead.length) serverSocket.write(clientHead);
            clientSocket.pipe(serverSocket);
            serverSocket.on('end', () => {
                serverSocket.end();
                clientSocket.end();
            });
        });
        serverSocket.pipe(clientSocket);

        clientSocket.on('error', (err) => {
            const obj: { stack?: any; } = {};
            Error.captureStackTrace(obj);
            console.log(obj.stack);
            console.error(err);
        });
        serverSocket.on('error', (err) => {
            const obj: { stack?: any; } = {};
            Error.captureStackTrace(obj);
            console.log(obj.stack);
            console.error(err);
        });
    });

    server.on('clientError', (err) => {
        const obj: { stack?: any; } = {};
        Error.captureStackTrace(obj);
        console.log(obj.stack);
        console.error(err);
    });

    websocketServer(server, false);


    server.listen(60000, () => {
        console.log(`start: $ curl http://example.com/ -x http://localhost:${(server.address() as { port: number; }).port}/`);
    });
};
