import { defineConfig } from "drizzle-kit";

export function createDrizzleConfig(dialect: 'sqlite' | 'postgresql' | 'mysql') {
    return defineConfig({
        out: `./drizzle/migrations/${dialect}`,
        schema: './src/db/schema.ts',
        dialect: dialect,
        dbCredentials: {
            url: process.env.DLA_DB_PATH ?? './data/db.sqlite',
        },
        verbose: true,
        strict: true
    });
}
