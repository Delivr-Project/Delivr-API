import { Hono } from "hono";
import type { Context } from "hono";
import { router as attachmentsRouter } from "./attachments";

export const router = new Hono().basePath("/:mailId");

router.route('/attachments/:attachmentId', attachmentsRouter);