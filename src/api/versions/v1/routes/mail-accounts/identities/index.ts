import { Hono } from "hono";
import { MailIdentitiesModel } from "./model";
import { DB } from "../../../../../../db";
import { type DrizzleDB } from "../../../../../../db/utils";
import { and, eq, ne } from "drizzle-orm";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { z } from "zod";
import { AuthHandler } from "../../../../../utils/authHandler";
import { validator } from "hono-openapi";
import { MailAccountsModel } from "../model";
import { Logger } from "../../../../../../utils/logger";

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List Mail Identities",
        description: "Retrieve a list of mail identities for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.IDENTITIES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail identities retrieved successfully", MailIdentitiesModel.GetAll.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const mailIdentities = DB.instance().select().from(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.mail_account_id, mailAccount.id),
        ).all();
        
        return APIResponse.success(c, "Mail identities retrieved successfully", mailIdentities satisfies MailIdentitiesModel.GetAll.Response);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create Mail Identity",
        description: "Create a new mail identity for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.IDENTITIES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail identity created successfully", MailIdentitiesModel.CreateMailIdentity.Response)
        )
    }),

    validator("json", MailIdentitiesModel.CreateMailIdentity.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        try {

            const result = await DB.instance().transaction(async (tx: DrizzleDB) => {
                if (body.is_default) {
                    // If setting this mail identity as default, unset all other identities for this mail account
                    await tx.update(DB.Tables.mailIdentities).set({
                        is_default: false
                    }).where(
                        and(
                            eq(DB.Tables.mailIdentities.mail_account_id, mailAccount.id),
                            eq(DB.Tables.mailIdentities.is_default, true),
                        )
                    );
                }

                const inserted = await tx.insert(DB.Tables.mailIdentities).values({
                    ...body,
                    mail_account_id: mailAccount.id,
                }).returning().get();

                return inserted;
            });

            return APIResponse.success(c, "Mail identity created successfully", { id: result.id } satisfies MailIdentitiesModel.CreateMailIdentity.Response);


        } catch (error: any) {
            Logger.error("Failed to create mail identity", error.stack || error.message || error);
            return APIResponse.serverError(c, "Failed to create mail identity");
        }

    }
);

router.use('/:mailIdentityID/*',

    validator("param", MailIdentitiesModel.Params),

    async (c, next) => {
        // @ts-ignore
        const { mailIdentityID } = c.req.valid("param") as MailIdentitiesModel.Params;

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        const mailIdentity = DB.instance().select().from(DB.Tables.mailIdentities).where(
            and(
                eq(DB.Tables.mailIdentities.id, mailIdentityID),
                eq(DB.Tables.mailIdentities.mail_account_id, mailAccount.id),
            )
        ).get();

        if (!mailIdentity) {
            return APIResponse.notFound(c, "Mail identity with the specified ID does not exist");
        }

        // @ts-ignore
        c.set("mailIdentity", mailIdentity);

        await next();
    }
);

router.get('/:mailIdentityID',

    APIRouteSpec.authenticated({
        summary: "Get Mail Identity by ID",
        description: "Retrieve a specific mail identity by its ID for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.IDENTITIES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail identity retrieved successfully", MailIdentitiesModel.GetByID.Response),
            APIResponseSpec.notFound("Mail identity with the specified ID does not exist")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailIdentity = c.get("mailIdentity") as MailIdentitiesModel.BASE;

        return APIResponse.success(c, "Mail identity retrieved successfully", mailIdentity satisfies MailIdentitiesModel.GetByID.Response);
    }
);

router.put('/:mailIdentityID',

    APIRouteSpec.authenticated({
        summary: "Update Mail Identity",
        description: "Update a specific mail identity for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.IDENTITIES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mail identity updated successfully"),
            APIResponseSpec.notFound("Mail identity with the specified ID does not exist")
        )
    }),

    validator("json", MailIdentitiesModel.UpdateMailIdentity.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailIdentity = c.get("mailIdentity") as MailIdentitiesModel.BASE;

        try {

            await DB.instance().transaction(async (tx: DrizzleDB) => {
                if (body.is_default && !mailIdentity.is_default) {
                    // If setting this mail identity as default, unset all other identities for this mail account
                    await tx.update(DB.Tables.mailIdentities).set({
                        is_default: false
                    }).where(
                        and(
                            eq(DB.Tables.mailIdentities.mail_account_id, mailIdentity.mail_account_id),
                            eq(DB.Tables.mailIdentities.is_default, true),
                            ne(DB.Tables.mailIdentities.id, mailIdentity.id)
                        )
                    );
                }

                await tx.update(DB.Tables.mailIdentities).set({
                    ...body
                }).where(
                    eq(DB.Tables.mailIdentities.id, mailIdentity.id)
                );
            });

            return APIResponse.successNoData(c, "Mail identity updated successfully");

        } catch (error: any) {
            Logger.error("Failed to update mail identity", error.stack || error.message || error);
            return APIResponse.serverError(c, "Failed to update mail identity");
        }
    }
);

router.delete('/:mailIdentityID',

    APIRouteSpec.authenticated({
        summary: "Delete Mail Identity",
        description: "Delete a specific mail identity for a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.IDENTITIES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mail identity deleted successfully"),
            APIResponseSpec.notFound("Mail identity with the specified ID does not exist")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailIdentity = c.get("mailIdentity") as MailIdentitiesModel.BASE;

        await DB.instance().delete(DB.Tables.mailIdentities).where(
            eq(DB.Tables.mailIdentities.id, mailIdentity.id)
        );

        return APIResponse.successNoData(c, "Mail identity deleted successfully");
    }
);