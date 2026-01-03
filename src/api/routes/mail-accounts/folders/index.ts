import { Hono } from "hono";
import { MailAccountsFoldersModel } from "./model";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { validator } from "hono-openapi";
import { MailClientsCache } from "../../../../utils/mails/mail-clients-cache";
import { Logger } from "../../../../utils/logger";
import { MailFolderService } from "../../../utils/services/mailFolderService";

export const router = new Hono();


router.use('/:folderPath/*',

    validator('param', MailAccountsFoldersModel.Params),

    async (c, next) => {
        // @ts-ignore
        const { folderPath } = c.req.valid('param') as MailAccountsFoldersModel.Params;
        
        return MailFolderService.folderMiddleware(c, next, folderPath);
    }
);
