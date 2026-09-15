import fs from "fs";
import path from "path";

export type AppConfig = {
    dns: string[]; // upstream resolvers used to reach the real servers
    host: string; // bind address shared by every proxy listener
};

const CONFIG_PATH = path.join("config", "default.json");

const DEFAULTS: AppConfig = {
    dns: ["8.8.8.8"],
    host: "127.0.0.1"
};

// Loads config/default.json (relative to the working directory) and overlays it
// on the built-in defaults. A missing file, invalid JSON, or missing keys fall
// back to the defaults, so callers always get a fully typed config.
export const loadConfig = (): AppConfig => {
    if (!fs.existsSync(CONFIG_PATH)) {
        return DEFAULTS;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
        return DEFAULTS;
    }
    const raw = parsed as Record<string, unknown>;
    const dns = Array.isArray(raw.dns)
        ? raw.dns.filter((value): value is string => typeof value === "string")
        : DEFAULTS.dns;
    const host = typeof raw.host === "string" ? raw.host : DEFAULTS.host;
    return {
        dns: dns.length > 0 ? dns : DEFAULTS.dns,
        host
    };
};
