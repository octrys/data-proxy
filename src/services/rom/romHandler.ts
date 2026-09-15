import type { InterceptHandler } from "../../libraries";

// Observe-only handler for ROM. For now it only declares which requests to skip
// (anti-cheat and gameguard noise); the proxy logs everything else. Response
// rewriting can be added later by implementing onResponse and switching the
// proxy to intercept mode in index.ts.
export class RomHandler implements InterceptHandler {
    public readonly ignoreRequest = /(UnCheater|gameguard)/;
}
