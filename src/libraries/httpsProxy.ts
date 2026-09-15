import fs from "fs";
import dns from "dns";
import https from "https";
import tls from "tls";
import type { IncomingMessage, ServerResponse } from "http";
import type { LookupFunction } from "net";
import httpProxy from "http-proxy";
import { CertManager } from "./certManager";
import { Logger } from "./logger";
import { decodeWsTextFrame, type WsDirection } from "./wsFrame";
import type { InterceptHandler } from "./interceptHandler";

type ProxyServer = httpProxy<IncomingMessage, ServerResponse>;

export type HttpsProxyOptions = {
    dns: string[]; // upstream resolvers used to reach the real servers
    port?: number; // proxy listen port, default 443
    host?: string; // bind address, default 127.0.0.1
    intercept?: boolean; // buffer responses so a handler can rewrite them, default false
    verbose?: boolean; // dump headers and bodies to the log, default false
    defaultDomain?: string; // SNI fallback cert domain, default "data-proxy.com"
    logPrefix?: string; // logger prefix, default "https"
    certManager?: CertManager; // override cert generation/storage
};

// TLS-terminating HTTPS proxy on port 443. Generates a leaf certificate per
// incoming SNI name, forwards to the real upstream (resolved via the upstream
// DNS servers), and delegates inspection/rewriting to an InterceptHandler.
export class HttpsProxy {
    private readonly handler: InterceptHandler;
    private readonly proxy: ProxyServer;
    private readonly agent: https.Agent;
    private readonly certManager: CertManager;
    private readonly certificates = new Map<string, tls.SecureContext>();
    private readonly logger: Logger;
    private readonly port: number;
    private readonly host: string;
    private readonly intercept: boolean;
    private readonly verbose: boolean;
    private readonly defaultDomain: string;
    private server?: https.Server;

    constructor(handler: InterceptHandler, options: HttpsProxyOptions) {
        this.handler = handler;
        this.certManager = options.certManager ?? new CertManager();
        this.port = options.port ?? 443;
        this.host = options.host ?? "127.0.0.1";
        this.intercept = options.intercept ?? false;
        this.verbose = options.verbose ?? false;
        this.defaultDomain = options.defaultDomain ?? "data-proxy.com";
        this.logger = Logger.getInstance(options.logPrefix ?? "https");
        dns.setServers(options.dns);
        this.agent = new https.Agent({
            maxSockets: Infinity,
            lookup: this.resolveUpstream
        });
        this.proxy = httpProxy.createProxyServer({
            secure: false,
            agent: this.agent,
            preserveHeaderKeyCase: true
        });
    }

    public async start(): Promise<void> {
        this.certManager.cleanCertificates();
        const defaultCert = this.certManager.generateCertificate(this.defaultDomain);
        this.registerRequestListener();
        this.registerResponseListener();
        this.registerWsListeners();
        this.proxy.on("error", (error) => this.logger.log(`proxy error => ${error}`, "error"));
        const server = https.createServer(
            {
                cert: fs.readFileSync(defaultCert.certPath),
                key: fs.readFileSync(defaultCert.keyPath),
                SNICallback: (servername, callback) => {
                    try {
                        callback(null, this.contextFor(servername));
                    } catch (error) {
                        callback(error as Error);
                    }
                }
            },
            (request, response) => this.handleRequest(request, response)
        );
        server.on("upgrade", (request, socket, head) => {
            this.logger.log(`ws upgrade => wss://${request.headers.host}${request.url}`);
            this.proxy.ws(request, socket, head, {
                target: `wss://${request.headers.host}`,
                secure: false,
                agent: this.agent
            });
        });
        await new Promise<void>((resolve) => {
            this.server = server;
            server.listen(this.port, this.host, () => {
                this.logger.log(`https proxy listening on ${this.host}:${this.port}`);
                resolve();
            });
        });
    }

    private handleRequest(request: IncomingMessage, response: ServerResponse): void {
        const target = `https://${request.headers.host}`;
        if (this.verbose) {
            this.logger.log(`https => ${request.method} ${target}${request.url}`);
        }
        // Force an uncompressed upstream response so bodies stay readable for
        // logging and rewriting.
        delete request.headers["accept-encoding"];
        this.proxy.web(request, response, {
            target,
            selfHandleResponse: this.intercept
        });
    }

    private registerRequestListener(): void {
        this.proxy.on("proxyReq", (proxyReq, request) => {
            this.logger.log(`==> ${request.method} ${request.headers.host}${request.url}`);
            if (this.isIgnored(request.url)) {
                return;
            }
            if (this.verbose) {
                this.logger.log(`req headers => ${JSON.stringify(proxyReq.getHeaders())}`);
            }
            if (!this.handler.onRequest && !this.verbose) {
                return;
            }
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
                const body = Buffer.concat(chunks).toString();
                if (this.verbose && body) {
                    this.logger.log(`req body => ${body}`);
                }
                void this.handler.onRequest?.(request, body);
            });
        });
    }

    private registerResponseListener(): void {
        this.proxy.on("proxyRes", (proxyRes, request, response) => {
            this.logger.log(`<== ${request.method} ${request.headers.host}${request.url}`);
            if (this.isIgnored(request.url)) {
                if (this.intercept) {
                    proxyRes.pipe(response);
                }
                return;
            }
            if (this.verbose) {
                this.logger.log(`res headers => ${JSON.stringify(proxyRes.headers)}`);
            }
            const chunks: Buffer[] = [];
            proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
            proxyRes.on("end", () => {
                void this.finishResponse(request, response, Buffer.concat(chunks));
            });
        });
    }

    private async finishResponse(request: IncomingMessage, response: ServerResponse, raw: Buffer): Promise<void> {
        const body = raw.toString();
        if (this.verbose && body) {
            this.logger.log(`res body => ${body}`);
        }
        if (this.handler.onResponse) {
            try {
                const handled = await this.handler.onResponse(request, response, body);
                if (handled) {
                    return;
                }
            } catch (error) {
                this.logger.log(`handler error => ${error}`, "error");
            }
        }
        // In intercept mode the upstream response was not auto-piped, so we must
        // send the original bytes ourselves when the handler did not.
        if (this.intercept) {
            response.end(raw);
        }
    }

    private registerWsListeners(): void {
        this.proxy.on("proxyReqWs", (_proxyReq, request, socket) => {
            this.logger.log(`ws connect => wss://${request.headers.host}${request.url}`);
            socket.on("data", (data: Buffer) => this.emitWsMessage("client", data));
        });
        this.proxy.on("open", (proxySocket) => {
            proxySocket.on("data", (data: Buffer) => this.emitWsMessage("server", data));
        });
        this.proxy.on("close", () => this.logger.log("ws close"));
    }

    private emitWsMessage(direction: WsDirection, data: Buffer): void {
        const message = decodeWsTextFrame(data);
        if (message === null) {
            return;
        }
        this.logger.log(`ws ${direction} => ${message}`);
        this.handler.onWsMessage?.(direction, message);
    }

    private contextFor(domain: string): tls.SecureContext {
        const cached = this.certificates.get(domain);
        if (cached) {
            return cached;
        }
        const { certPath, keyPath } = this.certManager.generateCertificate(domain);
        const context = tls.createSecureContext({
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
        });
        this.certificates.set(domain, context);
        this.logger.log(`loaded tls context for ${domain}`);
        return context;
    }

    private isIgnored(url?: string): boolean {
        if (!url || !this.handler.ignoreRequest) {
            return false;
        }
        return this.handler.ignoreRequest.test(url);
    }

    // Custom lookup so the proxy resolves the real upstream IP through the
    // configured DNS servers rather than the client's redirected resolver.
    private readonly resolveUpstream: LookupFunction = (hostname, options, callback) => {
        dns.resolve4(hostname, (error, addresses) => {
            if (error) {
                this.logger.log(`dns lookup failed for ${hostname} => ${error}`, "error");
                callback(error, "", 4);
                return;
            }
            if (addresses.length === 0) {
                callback(new Error(`no A record for ${hostname}`), "", 4);
                return;
            }
            if (options.all) {
                callback(null, addresses.map((address) => ({ address, family: 4 })));
                return;
            }
            callback(null, addresses[0], 4);
        });
    };
}
