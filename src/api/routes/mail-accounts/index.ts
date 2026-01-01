import { Hono } from "hono";
import type { Context } from "hono";
import { router as mailsRouter } from "./mails";

export const router = new Hono().basePath('/mail-accounts');

router.route('/:accountId/mails', mailsRouter);