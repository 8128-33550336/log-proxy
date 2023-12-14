import { unlink } from 'fs/promises';
import { createServer } from "https";
import { createSecureContext } from "tls";
import * as net from 'net';

import { getCert } from "./keys.ts";
import { requestListener, websocketServer } from "./common.ts";

export const start = async () => {
    try {
        await unlink('./https.sock');
    } catch { }


    const server = createServer({
        async SNICallback(servername, cb) {
            console.log(servername);
            const domainRegExp = /^[a-zA-Z0-9-\.]+$/;
            const key = await (() => {
                if (net.isIPv4(servername)) {
                    return getCert('ip', servername);
                } else if (net.isIPv6(servername.slice(1, -1))) {
                    return getCert('ip', servername.slice(1, -1));
                } else if (servername.match(domainRegExp)) {
                    return getCert('domain', servername);
                }
                return null;
            })();
            if (!key) {
                cb(null, undefined);
                return;
            }
            try {
                const context = createSecureContext({
                    key: Buffer.from(key.key),
                    cert: key.cert
                });
                cb(null, context);
            } catch (error) {
                console.error(error);
                throw 0;
            }
        },
        requestTimeout: 0
    }, requestListener(true));

    server.on('clientError', (err) => {
        const obj: { stack?: any; } = {};
        Error.captureStackTrace(obj);
        console.log(obj.stack);
        console.error(err);
    });


    websocketServer(server, true);

    server.listen('./https.sock');
};
