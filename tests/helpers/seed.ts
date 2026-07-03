import { randomUUID } from "crypto";
import { DB } from "../../src/db";
import { SessionHandler } from "../../src/api/utils/authHandler";

export type SeededUser = Omit<DB.Models.User, "password_hash"> & { password: string };

const DEFAULT_PASSWORD = "TestP@ssw0rd";

export async function seedUser(
    role: DB.Models.User["role"] = "user",
    overrides: Partial<DB.Models.User> = {},
    password: string = DEFAULT_PASSWORD
): Promise<SeededUser> {
    const user = DB.instance().insert(DB.Tables.users).values({
        username: overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
        display_name: overrides.display_name ?? "Test User",
        email: overrides.email ?? `${randomUUID()}@example.com`,
        password_hash: await Bun.password.hash(password),
        role,
    } as any).returning().get();

    return { ...user, password };
}

export async function seedSession(user_id: number): Promise<string> {
    const session = await SessionHandler.createSession(user_id);
    return session.token;
}

