import { createServer } from "http";
import { caCert } from "./keys.ts";

export const start = () => {
    const server = createServer(async (req, res) => {
        if (req.url === '/cert.pem') {
            res.writeHead(200, { 'Content-Type': 'application/x-pem-file' });
            res.write(caCert);
            res.end();
            return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.write('Not Found');
        res.end();
    });

    server.listen(60001);
};
