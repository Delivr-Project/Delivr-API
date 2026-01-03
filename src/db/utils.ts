import { sql, type ColumnBuilderBase, type HasDefault, type IsPrimaryKey, type NotNull } from 'drizzle-orm';

import { drizzle as drizzle_sqlite } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzle_postgresql } from 'drizzle-orm/bun-sql';
import { drizzle as drizzle_mysql } from 'drizzle-orm/mysql2';

import { integer as integer_sqlite } from 'drizzle-orm/sqlite-core';
import { integer as integer_postgresql } from 'drizzle-orm/pg-core';
import { int as integer_mysql } from 'drizzle-orm/mysql-core';

import { serial as serial_postgresql } from 'drizzle-orm/pg-core';

// export type DrizzleDB = ReturnType<typeof drizzle_sqlite> | ReturnType<typeof drizzle_postgresql> | ReturnType<typeof drizzle_mysql>;
export type DrizzleDB = ReturnType<typeof drizzle_sqlite>;

export namespace SQLUtils {

    export function getCreatedAtColumn(dialect: "sqlite"): NotNullDefault<ReturnType<typeof integer_sqlite>>;
    export function getCreatedAtColumn(dialect: "postgresql"): NotNullDefault<ReturnType<typeof integer_postgresql>>;
    export function getCreatedAtColumn(dialect: "mysql"): NotNullDefault<ReturnType<typeof integer_mysql>>;
    export function getCreatedAtColumn(dialect: Dialect): any {
        // return integer("created_at", { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`);
        switch (dialect) {
            case 'sqlite':
                return integer_sqlite("created_at", { mode: 'number' }).notNull().default(sql`(unixepoch() * 1000)`);
            case 'postgresql':
                return integer_postgresql("created_at").notNull().default(sql`(EXTRACT(EPOCH FROM NOW()) * 1000)`);
            case 'mysql':
                return integer_mysql("created_at").notNull().default(sql`(UNIX_TIMESTAMP() * 1000)`)
        }
    }

    export function primaryKeyIntAutoIncrement(dialect: "sqlite"): PrimaryKey<ReturnType<typeof integer_sqlite>>;
    export function primaryKeyIntAutoIncrement(dialect: "postgresql"): PrimaryKey<ReturnType<typeof serial_postgresql>>;
    export function primaryKeyIntAutoIncrement(dialect: "mysql"): PrimaryKey<ReturnType<typeof integer_mysql>>;
    export function primaryKeyIntAutoIncrement(dialect: Dialect): any {
        switch (dialect) {
            case 'sqlite':
                return integer_sqlite().primaryKey({ autoIncrement: true });
            case 'postgresql':
                return serial_postgresql().primaryKey();
            case 'mysql':
                return integer_mysql().autoincrement().primaryKey();
        }
    }

}

export namespace SQLUtils {

    export type Dialect = 'sqlite' | 'postgresql' | 'mysql';

    export type NotNullDefault<T extends ColumnBuilderBase> = HasDefault<NotNull<T>>;

    export type PrimaryKey<T extends ColumnBuilderBase> = IsPrimaryKey<NotNullDefault<T>>;

}