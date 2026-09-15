import type { IncomingMessage, ServerResponse } from "http";
import type { WsDirection } from "./wsFrame";

// Contract a service implements to inspect or rewrite intercepted traffic.
// The proxy handles all wiring (TLS, buffering, ignore filtering, logging);
// a handler only supplies the decision points. Every hook is optional so an
// observe-only service can implement none of them.
export type InterceptHandler = {
    // URLs matching this pattern are forwarded untouched (static assets, noise)
    // and never buffered or passed to the hooks below.
    readonly ignoreRequest?: RegExp;

    // Observe an outgoing request body before it reaches the upstream.
    onRequest?(request: IncomingMessage, body: string): void | Promise<void>;

    // Inspect or rewrite an upstream response. Return true when the handler has
    // fully written and ended the response itself; return false to let the
    // proxy forward the original body unchanged. Only meaningful when the proxy
    // runs in intercept mode.
    onResponse?(request: IncomingMessage, response: ServerResponse, body: string): boolean | Promise<boolean>;

    // Observe a decoded WebSocket text frame in either direction.
    onWsMessage?(direction: WsDirection, message: string): void;
};
