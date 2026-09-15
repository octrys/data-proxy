import fs from "fs";
import path from "path";
import forge from "node-forge";
import { Logger } from "./logger";

const logger = Logger.getInstance("cert");

export type CertManagerOptions = {
    caDir?: string; // directory holding the signing CA, default "storage/ca"
    caName?: string; // base name of the CA files, default "data-proxy"
    certDir?: string; // where generated leaf certs are written, default "storage/certs"
    organization?: string; // organizationName attribute on leaf certs
    validityDays?: number; // leaf cert lifetime, default 365
};

export type CertificatePaths = {
    certPath: string;
    keyPath: string;
};

// Signs per-domain leaf certificates with the local CA. Generated leaves are
// cached on disk and reused; the CA itself is never modified.
export class CertManager {
    private readonly caCertPath: string;
    private readonly caKeyPath: string;
    private readonly certDir: string;
    private readonly organization: string;
    private readonly validityDays: number;

    constructor(options: CertManagerOptions = {}) {
        const caDir = options.caDir ?? "storage/ca";
        const caName = options.caName ?? "data-proxy";
        this.caCertPath = path.join(caDir, `${caName}.crt`);
        this.caKeyPath = path.join(caDir, `${caName}.key`);
        this.certDir = options.certDir ?? "storage/certs";
        this.organization = options.organization ?? "data-proxy";
        this.validityDays = options.validityDays ?? 365;
    }

    // Returns the paths to a CA-signed leaf cert for the domain, generating and
    // persisting it on first request.
    public generateCertificate(domain: string): CertificatePaths {
        fs.mkdirSync(this.certDir, { recursive: true });
        const certPath = path.join(this.certDir, `${domain}.crt`);
        const keyPath = path.join(this.certDir, `${domain}.key`);
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            return { certPath, keyPath };
        }
        const caCert = forge.pki.certificateFromPem(fs.readFileSync(this.caCertPath, "utf8"));
        const caKey = forge.pki.privateKeyFromPem(fs.readFileSync(this.caKeyPath, "utf8"));
        const keys = forge.pki.rsa.generateKeyPair(2048);
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = this.randomSerial();
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
        cert.validity.notAfter = new Date(cert.validity.notBefore);
        cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + this.validityDays);
        cert.setSubject([
            { name: "commonName", value: domain },
            { name: "organizationName", value: this.organization }
        ]);
        cert.setIssuer(caCert.subject.attributes);
        cert.setExtensions([
            { name: "basicConstraints", cA: false },
            { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
            { name: "subjectAltName", altNames: [{ type: 2, value: domain }] }
        ]);
        cert.sign(caKey, forge.md.sha256.create());
        fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
        fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
        logger.log(`generated leaf certificate for ${domain}`);
        return { certPath, keyPath };
    }

    // Removes every generated leaf cert and key (the CA is left untouched).
    // Called on proxy start so stale certs never outlive a CA change.
    public cleanCertificates(): void {
        if (!fs.existsSync(this.certDir)) {
            return;
        }
        for (const entry of fs.readdirSync(this.certDir, { withFileTypes: true })) {
            if (entry.isFile() && /\.(crt|key)$/.test(entry.name)) {
                const filePath = path.join(this.certDir, entry.name);
                fs.rmSync(filePath);
                logger.log(`removed ${filePath}`, "warn");
            }
        }
    }

    // 16 random bytes as hex, prefixed with "00" so forge never reads the high
    // bit as a negative serial. A unique serial per leaf avoids clients
    // rejecting duplicate serials from the same issuer.
    private randomSerial(): string {
        return `00${forge.util.bytesToHex(forge.random.getBytesSync(16))}`;
    }
}
