import { Logger } from "./logger";

interface ConfigSchemaSetting<
    REQUIRED extends ConfigSchemaSetting.Required,
    TYPE extends ConfigSchemaSetting.Type = undefined,
    //DEPENDENCIES extends ConfigSchemaSetting.Dependencies = undefined
> {
    required: REQUIRED;
    type?: TYPE;
    //dependencies?: DEPENDENCIES;
}

namespace ConfigSchemaSetting {
    export type Required = boolean;
    export type Type = string[] | boolean[] | undefined;
    export type Dependencies = Record<string, string[]> | undefined;
    export type Sample = ConfigSchemaSetting<Required, Type/*, Dependencies*/>;
}

type ConfigValueType<
    T extends ConfigSchemaSetting.Sample,
    F = [T] extends [ConfigSchemaSetting<any, infer U/*, any*/>]
    ? U extends (string | boolean)[]
        ? U[number]
        : string
    : string
> = T["required"] extends true ? F : F | undefined;

interface ConfigSchemaSettings {
    [key: string]: ConfigSchemaSetting.Sample;
}

type ConfigLike<T extends ConfigSchemaSettings> = {
    [K in keyof T]: ConfigValueType<T[K]>;
}

class ConfigSchema<T extends ConfigSchemaSettings = {}> {

    readonly schema: T = {} as any;

    public add<
        KEY extends string,
        Setings extends ConfigSchemaSetting<ISREQUIRED, TYPE/*, DEPENDENCIES*/>,
        ISREQUIRED extends boolean,
        const TYPE extends ConfigSchemaSetting.Type = undefined,
        //const DEPENDENCIES extends ConfigSchemaSetting.Dependencies = undefined
    >(
        key: KEY,
        required = false as ISREQUIRED,
        type?: TYPE,
        //dependencies?: DEPENDENCIES
    ) {
        (this.schema as any)[key] = { required, type/*, dependencies*/ };
        return this as any as ConfigSchema<T & { [K in KEY]: Setings }>;
    }

    public parse() {
        const result: ConfigLike<T> = {} as ConfigLike<T>;

        for (const [key, settings] of Object.entries(this.schema)) {
            
            const value = process.env[key];

            if (!value) {
                if (settings.required) {
                    Logger.error(`The environment variable ${key} is required but not set.`);
                    process.exit(1);
                }
                continue;
            }

            if (settings.type) {
                if (typeof settings.type[0] === "boolean") {
                    (result[key] as any) = value.toLowerCase() === "true" ? true : false;
                    continue;
                }
                if (!(settings.type as string[]).includes(value.toLowerCase())) {
                    Logger.error(`The environment variable ${key} has to be one of the following: ${settings.type.join(", ")}`);
                    process.exit(1);
                }
            }

            (result[key] as any) = value;

            /*if (settings.dependencies) {
                const dependencies = settings.dependencies[process.env[key]] || settings.dependencies["any"];
                if (!dependencies) continue;

                for (const dep of dependencies) {
                    if (!process.env[dep]) {
                        Logger.error(`The environment variable ${dep} is required by ${key} but not set.`);
                        process.exit(1);
                    }
                }
            }*/
        }
        return result;
    }

}

// @ts-ignore
export type ParsedConfig = ConfigLike<typeof ConfigHandler.schema.schema>;

export class ConfigHandler {

    private static schema = new ConfigSchema()
        .add("DLA_LOG_LEVEL", false, ["debug", "info", "warn", "error", "critical"])

        .add("DLA_APP_URL", true)

        .add("DLA_API_HOST", false)
        .add("DLA_API_PORT", false)
        .add("DLA_DISABLE_DOCS", false, [true, false])

        .add("DLA_LOG_DIR", false)
        .add("DLA_CONFIG_BASE_DIR", false)

        .add("DLA_DB_PATH", false)
        .add("DLA_DB_AUTO_MIGRATE", false, [true, false]);


    private static config: ParsedConfig | null = null;

    /** You have to call {@link ConfigHandler.parseConfigFile} before trying to access the config. */
    static getConfig() {
        return this.config;
    }

    static async loadConfig() {
        if (this.config) return this.config;
        this.config = this.schema.parse();
        return this.config;
    }

}
