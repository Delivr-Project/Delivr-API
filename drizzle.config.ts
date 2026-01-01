import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    out: './drizzle',
    schema: './src/db/schema.ts',
    dialect: 'sqlite',
    dbCredentials: {
        url: process.env.DLA_DB_PATH ?? './data/db.sqlite',
    },
    verbose: true,
    strict: true
});
