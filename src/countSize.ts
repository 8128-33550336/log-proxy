import { Writable } from "stream";

export const createCounter = () => {
    let size = 0;
    const sizeCount = new Writable({
        write(chunk, _, callback) {
            size += chunk.length;
            callback();
        },
    });
    const promise = new Promise((resolve, reject) => {
        sizeCount.on('finish', () => {
            resolve(size);
        });
        sizeCount.on('error', (err) => {
            reject(err);
        });
    });
    return {
        promise,
        stream: sizeCount
    };
};
