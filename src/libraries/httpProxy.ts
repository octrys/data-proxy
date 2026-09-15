import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import express from "express";
import httpProxy from "http-proxy";
import { Logger } from "./logger";

type ProxyServer = httpProxy<IncomingMessage, ServerResponse>;

export type HttpProxyOptions = {
    port?: number; // proxy listen port, default 80
    host?: string; // bind address, default 127.0.0.1
    caPort?: number; // static server exposing the CA cert, default 3000
    caDir?: string; // directory served on caPort, default "storage/ca"
    intercept?: boolean; // buffer responses instead of streaming, default false
    logPrefix?: string; // logger prefix, default "http"
};

// Plain HTTP proxy on port 80. Also serves the CA directory over HTTP so
// client devices can download and install the root certificate.
export class HttpProxy {
    private readonly proxy: ProxyServer;
    private readonly logger: Logger;
    private readonly port: number;
    private readonly host: string;
    private readonly caPort: number;
    private readonly caDir: string;
    private readonly intercept: boolean;
    private server?: http.Server;

    constructor(options: HttpProxyOptions = {}) {
        this.port = options.port ?? 80;
        this.host = options.host ?? "127.0.0.1";
        this.caPort = options.caPort ?? 3000;
        this.caDir = options.caDir ?? "storage/ca";
        this.intercept = options.intercept ?? false;
        this.logger = Logger.getInstance(options.logPrefix ?? "http");
        this.proxy = httpProxy.createProxyServer();
    }

    public async start(): Promise<void> {
        this.serveCaCertificate();
        this.proxy.on("error", (error) => this.logger.log(`proxy error => ${error}`, "error"));
        const server = http.createServer((request, response) => this.handleRequest(request, response));
        await new Promise<void>((resolve) => {
            this.server = server;
            server.listen(this.port, this.host, () => {
                this.logger.log(`http proxy listening on ${this.host}:${this.port}`);
                resolve();
            });
        });
    }

    private handleRequest(request: IncomingMessage, response: ServerResponse): void {
        const target = `http://${request.headers.host}`;
        this.logger.log(`http => ${request.method} ${target}${request.url}`);
        this.proxy.web(request, response, {
            target,
            selfHandleResponse: this.intercept
        });
    }

    private serveCaCertificate(): void {
        const app = express();
        app.use(express.static(this.caDir));
        app.listen(this.caPort, this.host, () => {
            this.logger.log(`ca download server listening on ${this.host}:${this.caPort}`);
        });
    }
}
