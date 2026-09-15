import { HttpProxy, HttpsProxy, Logger } from "../../libraries";
import { loadConfig } from "../../config";
import { RomHandler } from "./romHandler";

const logger = Logger.getInstance("rom");

const main = async (): Promise<void> => {
    const config = loadConfig();
    const handler = new RomHandler();
    const httpProxy = new HttpProxy({ host: config.host });
    const httpsProxy = new HttpsProxy(handler, {
        dns: config.dns,
        host: config.host,
        intercept: false,
        verbose: true,
        logPrefix: "rom"
    });
    await httpProxy.start();
    await httpsProxy.start();
    logger.log("rom proxy running (observe + log)");
};

main().catch((error) => {
    logger.log(`fatal => ${error}`, "error");
    process.exit(1);
});
