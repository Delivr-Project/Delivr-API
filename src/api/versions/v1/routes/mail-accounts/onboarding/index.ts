import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { validator } from "hono-openapi";
import { MailAccountOnboardingModel } from "./model";
import { MailAccountsModel } from "../model";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { Logger } from "../../../../../../utils/logger";

export const router = new Hono();

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get account onboarding state",
        description: "Retrieve whether the per-account, one-time folder onboarding has been finished for this mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Onboarding state retrieved successfully", MailAccountOnboardingModel.Get.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        try {
            const row = DB.instance().select({
                finished: DB.Tables.mailAccounts.onboarding_finished
            }).from(DB.Tables.mailAccounts).where(
                eq(DB.Tables.mailAccounts.id, mailAccount.id)
            ).get();

            return APIResponse.success(c, "Onboarding state retrieved successfully", {
                finished: row?.finished ?? false
            } satisfies MailAccountOnboardingModel.Get.Response);
        } catch (e) {
            Logger.error(`Failed to retrieve onboarding state for mail account ${mailAccount.id}`, e);
            return APIResponse.serverError(c, "Failed to retrieve onboarding state");
        }
    }
);

router.put('/',

    APIRouteSpec.authenticated({
        summary: "Update account onboarding state",
        description: "Set whether the per-account, one-time folder onboarding has been finished for this mail account.",
        tags: [DOCS_TAGS.MAIL_ACCOUNTS.BASE],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Onboarding state updated successfully", MailAccountOnboardingModel.Update.Response)
        )
    }),

    validator("json", MailAccountOnboardingModel.Update.Body),

    async (c) => {
        const body = c.req.valid("json");

        // @ts-ignore
        const mailAccount = c.get("mailAccount") as MailAccountsModel.BASE;

        try {
            await DB.instance().update(DB.Tables.mailAccounts).set({
                onboarding_finished: body.finished
            }).where(
                eq(DB.Tables.mailAccounts.id, mailAccount.id)
            );

            return APIResponse.success(c, "Onboarding state updated successfully", {
                finished: body.finished
            } satisfies MailAccountOnboardingModel.Update.Response);
        } catch (e) {
            Logger.error(`Failed to update onboarding state for mail account ${mailAccount.id}`, e);
            return APIResponse.serverError(c, "Failed to update onboarding state");
        }
    }
);
