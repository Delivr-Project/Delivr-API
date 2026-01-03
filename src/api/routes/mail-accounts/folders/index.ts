import { Hono } from "hono";
import { MailAccountsFoldersModel } from "./model";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { validator } from "hono-openapi";
import { MailAccountsModel } from "../model";
import { MailClientsCache } from "../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../utils/logger";

export const router = new Hono();

