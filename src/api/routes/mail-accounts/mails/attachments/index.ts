import { Hono } from "hono";
import type { Context } from "hono";

export const router = new Hono().basePath("/:mailId");
