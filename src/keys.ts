import { writeFile, readFile, mkdir } from 'fs/promises';
import forge from 'node-forge';

const pki = forge.pki;

const generateCa = async () => {
    const caKey = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = caKey.publicKey;

    cert.validity.notBefore = new Date();

    cert.validity.notAfter = (() => {
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        return nextYear;
    })();

    cert.setSubject([ {
        name: 'commonName',
        value: 'log-proxy-ca'
    } ]);

    cert.setIssuer([ {
        name: 'commonName',
        value: 'log-proxy-ca'
    } ]);

    cert.setExtensions([ {
        name: 'basicConstraints',
        cA: true
    }, {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
    } ]);

    cert.sign(caKey.privateKey, forge.md.sha256.create());
    const pem = pki.certificateToPem(cert);

    await Promise.all([
        writeFile('certs/ca/cert.pem', pem),
        writeFile('certs/ca/pub.pem', pki.publicKeyToPem(caKey.publicKey)),
        writeFile('certs/ca/priv.pem', pki.privateKeyToPem(caKey.privateKey)),
    ]);
    return {
        cert: pem,
        priv: caKey.privateKey
    };
};

const caKeys = await (async () => {
    await mkdir('certs/ca', { recursive: true });
    await mkdir('certs/others', { recursive: true });
    try {
        const certPem = await readFile('certs/ca/cert.pem', 'utf8');
        const privPem = await readFile('certs/ca/priv.pem', 'utf8');


        return {
            cert: certPem,
            priv: pki.privateKeyFromPem(privPem)
        };

    } catch (error) {
        return await generateCa();
    }
})();


const genCert = async (type: 'domain' | 'ip', domainOrIp: string) => {
    const key = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = key.publicKey;

    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();

    cert.validity.notAfter = (() => {
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        return nextYear;
    })();

    cert.setSubject([ {
        name: 'commonName',
        value: domainOrIp
    } ]);

    cert.setIssuer([ {
        name: 'commonName',
        value: 'log-proxy-ca'
    } ]);

    cert.setExtensions([ {
        name: 'basicConstraints',
        cA: false
    }, {
        name: 'keyUsage',
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
    }, {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
    }, {
        name: 'subjectAltName',
        altNames: [ {
            type: type === 'domain' ? 2 : 7,
            value: domainOrIp
        } ]
    } ]);

    cert.sign(caKeys.priv, forge.md.sha256.create());

    const pem = pki.certificateToPem(cert);
    const privPem = pki.privateKeyToPem(key.privateKey);
    await Promise.all([
        writeFile(`certs/others/${domainOrIp}.cert.pem`, pem),
        writeFile(`certs/others/${domainOrIp}.key-priv.pem`, privPem),
    ]);
    return { cert: pem, key: privPem };
};


export const getCert = async (type: 'domain' | 'ip', domainOrIp: string) => {
    try {
        const certPem = await readFile(`certs/others/${domainOrIp}.cert.pem`, 'utf8');
        const privPem = await readFile(`certs/others/${domainOrIp}.key-priv.pem`, 'utf8');
        return {
            cert: certPem,
            key: privPem
        };
    } catch (error) {
        return await genCert(type, domainOrIp);
    }
};

export const caCert = caKeys.cert;

