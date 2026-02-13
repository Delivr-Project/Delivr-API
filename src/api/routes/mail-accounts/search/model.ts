import { z } from "zod";
import { MailsModel } from "../mailboxes/mails/model";
import type { Utils } from "../../../../utils";
import type { IMAPAccount } from "../../../../utils/mails/backends/imap";

export namespace SearchModel {

    /**
     * Search query parameters for cross-folder email search
     */
    export const SearchQuery = z.object({
        /** Full-text search across subject, from, to, and body */
        text: z.string().optional().describe("Full-text search across subject, from, to, and body"),
        
        /** Search in subject field */
        subject: z.string().optional().describe("Search in email subject"),
        
        /** Search in from field */
        from: z.string().optional().describe("Search in sender address or name"),
        
        /** Search in to field */
        to: z.string().optional().describe("Search in recipient addresses"),
        
        /** Search in body content */
        body: z.string().optional().describe("Search in email body content"),
        
        /** Messages since this date (Unix timestamp in ms) */
        since: z.coerce.number().int().positive().optional()
            .describe("Return messages since this date (Unix timestamp in milliseconds)"),
        
        /** Messages before this date (Unix timestamp in ms) */
        before: z.coerce.number().int().positive().optional()
            .describe("Return messages before this date (Unix timestamp in milliseconds)"),
        
        /** Filter by attachment presence */
        hasAttachment: z.coerce.boolean().optional()
            .describe("Filter emails by attachment presence"),
        
        /** Filter by seen/read status */
        seen: z.coerce.boolean().optional()
            .describe("Filter by read/unread status (true = read, false = unread)"),
        
        /** Filter by flagged/starred status */
        flagged: z.coerce.boolean().optional()
            .describe("Filter by flagged/starred status"),
        
        /** Filter by answered status */
        answered: z.coerce.boolean().optional()
            .describe("Filter by replied-to status"),
        
        /** Filter by draft status */
        draft: z.coerce.boolean().optional()
            .describe("Filter by draft status")
    });

    export type SearchQuery = Utils.SameType<z.infer<typeof SearchQuery>, IMAPAccount.SearchQuery>;

    /**
     * Search result item containing mail data and its mailbox location
     */
    export const SearchResultItem = z.object({
        /** Path of the mailbox containing this mail */
        mailboxPath: z.string().describe("Path of the mailbox containing this email"),
        
        /** Name of the mailbox */
        mailboxName: z.string().describe("Display name of the mailbox"),
        
        /** Special use flag of the mailbox, if any */
        specialUse: z.string().optional().describe("Special use flag (e.g., \\Sent, \\Drafts, \\Trash)"),
        
        /** The mail data */
        mail: MailsModel.Mail
    });

    export type SearchResultItem = z.infer<typeof SearchResultItem>;
}

export namespace SearchModel.CrossFolderSearch {

    /**
     * Query parameters for cross-folder search endpoint
     */
    export const Query = z.object({
        /** Sort order by date */
        order: z.enum(["newest", "oldest"]).default("newest")
            .describe("Sort order by email date"),
        
        /** Maximum number of results */
        limit: z.coerce.number().int().positive().min(1).max(100).default(50)
            .describe("Maximum number of results to return"),
        
        /** Offset for pagination */
        offset: z.coerce.number().int().min(0).default(0)
            .describe("Number of results to skip for pagination"),
        
        /** Specific mailboxes to search (comma-separated paths, searches all if not specified) */
        mailboxes: z.string().optional()
            .describe("Comma-separated list of mailbox paths to search (searches all if not specified)"),
        
        /** Mailboxes to exclude from search (comma-separated paths) */
        excludeMailboxes: z.string().optional()
            .describe("Comma-separated list of mailbox paths to exclude from search"),

        /** Whether to include Trash folder in search */
        includeTrash: z.coerce.boolean().default(false)
            .describe("Include Trash/Deleted items folder in search"),

        /** Whether to include Spam/Junk folder in search */
        includeSpam: z.coerce.boolean().default(false)
            .describe("Include Spam/Junk folder in search"),

        /** Whether to include Drafts folder in search */
        includeDrafts: z.coerce.boolean().default(true)
            .describe("Include Drafts folder in search")
    });

    export type Query = z.infer<typeof Query>;

    /**
     * Request body for cross-folder search
     */
    export const Body = SearchModel.SearchQuery.refine(
        (data) => {
            // At least one search criterion must be provided
            return data.text || data.subject || data.from || data.to || data.body ||
                   data.since !== undefined || data.before !== undefined ||
                   data.hasAttachment !== undefined || data.seen !== undefined ||
                   data.flagged !== undefined || data.answered !== undefined ||
                   data.draft !== undefined;
        },
        {
            message: "At least one search criterion must be provided"
        }
    );

    export type Body = z.infer<typeof Body>;

    /**
     * Response containing search results
     */
    export const Response = z.object({
        /** Total number of results found (before pagination) */
        total: z.number().int().min(0).describe("Total number of matching emails across all searched mailboxes"),
        
        /** Number of mailboxes searched */
        mailboxesSearched: z.number().int().min(0).describe("Number of mailboxes that were searched"),
        
        /** Search results */
        results: z.array(SearchModel.SearchResultItem).describe("Array of search results with mailbox information")
    });

    export type Response = z.infer<typeof Response>;
}

export namespace SearchModel.QuickSearch {

    /**
     * Query parameters for quick search (GET endpoint with simple query string)
     */
    export const Query = z.object({
        /** Search query string */
        q: z.string().min(1).describe("Search query string"),
        
        /** Sort order by date */
        order: z.enum(["newest", "oldest"]).default("newest")
            .describe("Sort order by email date"),
        
        /** Maximum number of results */
        limit: z.coerce.number().int().positive().min(1).max(100).default(25)
            .describe("Maximum number of results to return"),
        
        /** Offset for pagination */
        offset: z.coerce.number().int().min(0).default(0)
            .describe("Number of results to skip for pagination"),

        /** Whether to include Trash folder in search */
        includeTrash: z.coerce.boolean().default(false)
            .describe("Include Trash/Deleted items folder in search"),

        /** Whether to include Spam/Junk folder in search */
        includeSpam: z.coerce.boolean().default(false)
            .describe("Include Spam/Junk folder in search")
    });

    export type Query = z.infer<typeof Query>;

    /**
     * Response for quick search
     */
    export const Response = SearchModel.CrossFolderSearch.Response;

    export type Response = z.infer<typeof Response>;
}

export namespace SearchModel.Count {

    /**
     * Query parameters for count endpoint (same as CrossFolderSearch but without limit/offset)
     */
    export const Query = SearchModel.CrossFolderSearch.Query.omit({ 
        limit: true, 
        offset: true 
    });

    export type Query = z.infer<typeof Query>;

    /**
     * Request body for count (same as CrossFolderSearch)
     */
    export const Body = SearchModel.CrossFolderSearch.Body;

    export type Body = z.infer<typeof Body>;

    /**
     * Per-mailbox count breakdown item
     */
    export const BreakdownItem = z.object({
        /** Path of the mailbox */
        mailboxPath: z.string().describe("Path of the mailbox"),
        
        /** Name of the mailbox */
        mailboxName: z.string().describe("Display name of the mailbox"),
        
        /** Number of matching emails in this mailbox */
        count: z.number().int().min(0).describe("Number of matching emails in this mailbox")
    });

    export type BreakdownItem = z.infer<typeof BreakdownItem>;

    /**
     * Response containing count and breakdown
     */
    export const Response = z.object({
        /** Total number of matching emails */
        total: z.number().int().min(0).describe("Total number of matching emails across all searched mailboxes"),
        
        /** Number of mailboxes searched */
        mailboxesSearched: z.number().int().min(0).describe("Number of mailboxes that were searched"),
        
        /** Per-mailbox breakdown of matching emails */
        breakdown: z.array(BreakdownItem).describe("Per-mailbox breakdown of matching emails, sorted by count descending")
    });

    export type Response = z.infer<typeof Response>;
}
