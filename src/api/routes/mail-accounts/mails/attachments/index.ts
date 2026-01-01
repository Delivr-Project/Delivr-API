import { Hono } from "hono";
import type { Context } from "hono";

export const router = new Hono().basePath("/:mailId");

router.get('/', async (c: Context) => {
    return c.json({ success: true, message: "Get mail details" });
});

router.delete('/', async (c: Context) => {
    return c.json({ success: true, message: "Delete mail" });
});