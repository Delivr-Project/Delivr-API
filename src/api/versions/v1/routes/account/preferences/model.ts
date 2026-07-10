import { z } from "zod";
import { UserPreferences } from "../../../../../utils/preferences";

export namespace AccountPreferencesModel.RemoteContentPolicy {

    export const Response = UserPreferences.schemas["remote-content-policy"];
    export type Response = z.infer<typeof Response>;

    export const Body = Response;
    export type Body = z.infer<typeof Body>;

}

export namespace AccountPreferencesModel.AutoMarkSeen {

    export const Response = UserPreferences.schemas["auto-mark-seen"];
    export type Response = z.infer<typeof Response>;

    export const Body = Response;
    export type Body = z.infer<typeof Body>;

}

export namespace AccountPreferencesModel.FolderNesting {

    export const Response = UserPreferences.schemas["folder-nesting"];
    export type Response = z.infer<typeof Response>;

    export const Body = Response;
    export type Body = z.infer<typeof Body>;

}

export namespace AccountPreferencesModel.FolderDnd {

    export const Response = UserPreferences.schemas["folder-dnd"];
    export type Response = z.infer<typeof Response>;

    export const Body = Response;
    export type Body = z.infer<typeof Body>;

}

export namespace AccountPreferencesModel.Onboarding {

    export const Response = UserPreferences.schemas["onboarding"];
    export type Response = z.infer<typeof Response>;

    export const Body = Response;
    export type Body = z.infer<typeof Body>;

}
