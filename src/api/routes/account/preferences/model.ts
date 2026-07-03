import { z } from "zod";
import { UserPreferences } from "../../../utils/preferences";

export namespace AccountPreferencesModel.RemoteContentPolicy {

    export const Response = UserPreferences.schemas["remote-content-policy"];
    export type Response = z.infer<typeof Response>;

    export const Body = Response;
    export type Body = z.infer<typeof Body>;

}

export namespace AccountPreferencesModel.MailListPageSize {

    export const Response = UserPreferences.schemas["mail-list-page-size"];
    export type Response = z.infer<typeof Response>;

    export const Body = Response;
    export type Body = z.infer<typeof Body>;

}
