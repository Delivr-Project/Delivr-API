import { Hono } from "hono";
import type { Context } from "hono";
import { router as attachmentsRouter } from "./attachments";

export const router = new Hono();

router.route('/', attachmentsRouter);

