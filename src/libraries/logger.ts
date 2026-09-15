import fs from "fs";
import { createLogger, format, transports, type Logger as WinstonLogger } from "winston";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_DIR = "logs";
const LOG_FILE = `${LOG_DIR}/app.log`;

// Winston wrapper with one instance per prefix. The prefix identifies which
// proxy or service emitted the line (e.g. "https", "cert", "ymir").
export class Logger {
    private static readonly instances = new Map<string, Logger>();
    private readonly logger: WinstonLogger;

    private constructor(prefix: string) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        this.logger = createLogger({
            level: "debug",
            format: format.combine(
                format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
                format.printf((info) => `${info.timestamp} ${info.level}:${prefix}=> ${info.message}`)
            ),
            transports: [
                new transports.Console({ level: "info" }),
                new transports.File({ filename: LOG_FILE, options: { flags: "a" } })
            ]
        });
    }

    public log(message: string, level: LogLevel = "info"): void {
        this.logger.log({ level, message });
    }

    public static getInstance(prefix = "main"): Logger {
        const existing = Logger.instances.get(prefix);
        if (existing) {
            return existing;
        }
        const created = new Logger(prefix);
        Logger.instances.set(prefix, created);
        return created;
    }
}
