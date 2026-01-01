import { API } from "./api";
import { DB } from "./db";
import { ConfigHandler } from "./utils/config";
import { Logger } from "./utils/logger";
import { Utils } from "./utils";

export class Main {

    static async main() {

        process.once("SIGINT", (type) => Main.gracefulShutdown(type, 0));
        process.once("SIGTERM", (type) => Main.gracefulShutdown(type, 0));

        process.once("uncaughtException", Main.handleUncaughtException);
        process.once("unhandledRejection", Main.handleUnhandledRejection);

        const config = await ConfigHandler.loadConfig();

        Logger.setLogLevel(config.DLA_LOG_LEVEL ?? "info");

        await DB.init(
            config.DLA_DB_PATH ?? "./data/db.sqlite",
            config.DLA_DB_AUTO_MIGRATE,
            config.DLA_CONFIG_BASE_DIR ?? "./config"
        );


        await Utils.ensureDirectoryExists(config.DLA_LOG_DIR ?? "./data/logs");


        await API.init([config.DLA_APP_URL || "https://api.delivr.local"]);

        await API.start(
            parseInt(config.DLA_API_PORT ?? "12151"),
            config.DLA_API_HOST ?? "::"
        );

    }

    private static async gracefulShutdown(type: NodeJS.Signals, code: number) {
        try {
            Logger.log(`Received ${type}, shutting down...`);
            await API.stop();
            Logger.log("Shutdown complete, exiting.");
            process.exit(code);
        } catch {
            Logger.critical("Error during shutdown, forcing exit");
            Main.forceShutdown();
        }
        }

    private static forceShutdown() {
        process.once("SIGTERM", ()=>{});
        process.exit(1);
    }

    private static async handleUncaughtException(error: Error) {
        Logger.critical(`Uncaught Exception:\n${Error.isError(error) ? error.stack ? error.stack : error.message : error}`);
        Main.gracefulShutdown("SIGTERM", 1);
    }

    private static async handleUnhandledRejection(reason: any) {
        if (Error.isError(reason)) {
            // reason is an error
            return Main.handleUncaughtException(reason);
        }
        Logger.critical(`Unhandled Rejection:\n${reason}`);
        Main.gracefulShutdown("SIGTERM", 1);
    }

}

Main.main()