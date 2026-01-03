import { defineConfig } from "drizzle-kit";

export function createDrizzleConfig(dialect: 'sqlite' | 'postgresql' | 'mysql') {
    return defineConfig({
        out: `./drizzle/migrations/${dialect}`,
        schema: `./src/db/schema/${dialect}.ts`,
        dialect: dialect,
        dbCredentials: {
            url: process.env.DLA_DB_CONNECTION_URL!!,
        },
        verbose: true,
        strict: true
    });
}
