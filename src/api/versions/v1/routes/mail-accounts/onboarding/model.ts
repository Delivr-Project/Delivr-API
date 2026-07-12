import { z } from "zod";

/**
 * Per-account folder-onboarding flag, mirroring the platform-wide `onboarding`
 * user preference but scoped to a single mail account.
 */
export namespace MailAccountOnboardingModel.Get {

    export const Response = z.object({
        finished: z.boolean().describe("Whether the per-account folder onboarding has been finished")
    });

    export type Response = z.infer<typeof Response>;
}

export namespace MailAccountOnboardingModel.Update {

    export const Body = z.object({
        finished: z.boolean().describe("Whether the per-account folder onboarding has been finished")
    });

    export type Body = z.infer<typeof Body>;

    export const Response = MailAccountOnboardingModel.Get.Response;

    export type Response = z.infer<typeof Response>;
}
