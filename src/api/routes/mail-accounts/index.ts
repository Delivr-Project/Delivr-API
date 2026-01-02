import { Context, Hono } from "hono";
import { MailAccountsModel } from './model';
import { DB } from "../../../db";
import { and, eq } from "drizzle-orm";
import { APIResponse } from "../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { router as mailsRouter } from "./mails";
import { router as identitiesRouter } from "./identities";
import { z } from "zod";
import { AuthHandler } from "../../utils/authHandler";
import { validator } from "hono-openapi";

export const router = new Hono().basePath('/mail-accounts');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List Mail Accounts",
        description: "Retrieve a list of mail accounts.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail accounts retrieved successfully", MailAccountsModel.GetAllMailAccounts.Response)
        )
    }),

    async (c) => {

        const authContext = AuthHandler.AuthContext.get(c);

        const mailAccounts = DB.instance().select().from(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.owner_user_id, authContext.user_id)
        ).all();

        return APIResponse.success(c, "Mail accounts retrieved successfully", mailAccounts satisfies MailAccountsModel.GetAllMailAccounts.Response);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create mail account",
        description: "Create a new mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Mail account created successfully", MailAccountsModel.CreateMailAccount.Response)
        )
    }),

    validator("json", MailAccountsModel.CreateMailAccount.Body),

    async (c) => {
        const body = c.req.valid("json");

        const authContext = AuthHandler.AuthContext.get(c);

        const result = await DB.instance().insert(DB.Schema.mailAccounts).values({
            ...body,
            owner_user_id: authContext.user_id
        }).returning().get().id;

        return APIResponse.success(c, "Mail account created successfully", { id: result } satisfies MailAccountsModel.CreateMailAccount.Response);
    }
);

router.use("/:mailAccountID/*",

    validator("param", MailAccountsModel.MailAccountIDParams),

    async (c, next) => {
        
        const authContext = AuthHandler.AuthContext.get(c);

        // @ts-ignore
        const { mailAccountID } = c.req.valid("param") as MailAccountsModel.MailAccountIDParams;

        const mailAccount = DB.instance().select().from(DB.Schema.mailAccounts).where(
            and(
                eq(DB.Schema.mailAccounts.id, mailAccountID),
                eq(DB.Schema.mailAccounts.owner_user_id, authContext.user_id)
            )
        ).get();

        if (!mailAccount) {
            return APIResponse.notFound(c, "Mail Account with the specified ID not found");
        }
        
        // @ts-ignore
        c.set("mailAccount", mailAccount as MailAccountsModel.BASE);

        await next();
    }
);

router.get('/:mailAccountID',

    APIRouteSpec.authenticated({
        summary: "Get Mail Account info",
        description: "Retrieve information about a specific mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Mail account retrieved successfully", MailAccountsModel.GetMailAccount.Response),
            APIResponseSpec.notFound("Mail Account with the specified ID not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        return APIResponse.success(c, "Mail account retrieved successfully", mailAccount satisfies MailAccountsModel.GetMailAccount.Response);
    }
);


router.put('/:mailAccountID',

    APIRouteSpec.authenticated({
        summary: "Update mail account",
        description: "Update a field in a mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Mail account updated successfully"),
            APIResponseSpec.notFound("Mail account with the specified ID not found")
        )
    }),

    validator("json", MailAccountsModel.UpdateMailAccount.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        await DB.instance().update(DB.Schema.mailAccounts).set(body).where(
            eq(DB.Schema.mailAccounts.id, mailAccount.id)
        )

        return APIResponse.successNoData(c, "Mail account updated successfully");
    }
);

router.delete('/:mailAccountID',

    APIRouteSpec.authenticated({
        summary: "Delete mail account",
        description: "Delete a mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Mail account deleted successfully"),
            APIResponseSpec.notFound("Mail account with the specified ID not found")
        )
    }),

    async (c) => {

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        // Delete all mail identities linked to this mail account
        await DB.instance().delete(DB.Schema.mailIdentities).where(
            eq(DB.Schema.mailIdentities.mail_account_id, mailAccount.id)
        );

        await DB.instance().delete(DB.Schema.mailAccounts).where(
            eq(DB.Schema.mailAccounts.id, mailAccount.id)
        );

        return APIResponse.successNoData(c, "Mail account deleted successfully");
        
    }
);

router.route("/:mailAccountID/mails", mailsRouter);
router.route("/:mailAccountID/identities", identitiesRouter);