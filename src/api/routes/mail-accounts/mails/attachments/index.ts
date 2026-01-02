import { Hono } from "hono";
import { z } from "zod";
import { MailAccountsModel } from "../../model";
import { validator } from "hono-openapi";

export const router = new Hono();