import { Hono } from "hono";
import { type GenerateSpecOptions, openAPIRouteHandler } from "hono-openapi";
import { Scalar } from '@scalar/hono-api-reference'

const openAPIConfig: Partial<GenerateSpecOptions> = {

    documentation: {
        info: {
            title: "Delivr API",
            version: "0.1.0",
            description: "API for Delivr Frontend and third-party clients",
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Enter your bearer token in the format **Bearer &lt;token&gt;**",
                }
            },
            responses: {
                undefined: {
                    description: "Authentication information is missing or invalid",
                },
            },
        },

        // Disable global security because Scalar could not handle multiple security schemes properly
        security: [{
            bearerAuth: []
        }],

        servers: [
            {
                url: "http://localhost:14123",
                description: "Local development server",
            },
            {
                url: "https://api.delivr.is-on.net",
                description: "Production server",
            },
        ],

        "x-tagGroups": [
            {
                name: "Account & Authentication",
                tags: [
                    "Account",
                    "Account / API Keys",
                    "Authentication",
                ]
            },
            {
                name: "Admin API",
                tags: [
                    "Admin API / Users"
                ]
            },
            {
                name: "Mail",
                tags: [
                    "Mail Accounts",
                    "Mail Accounts / Identities",
                    "Mail Accounts / Mailboxes",
                    "Mail Accounts / Mailboxes / Mails",
                    "Mail Accounts / Mailboxes / Mails / Attachments"
                ]
            }
        ],

        tags: [
            {
                name: "Account",
                description: "Endpoints for user account management",
            },
            {
                name: "Account / API Keys",
                // @ts-ignore
                "x-displayName": "API Keys",
                summary: "API Keys",
                parent: "Account",
                description: "Endpoints for managing account API keys",
            },

            {
                name: "Authentication",
                description: "Endpoints for authentication and authorization",
            },

            {
                name: "Admin API / Users",
                // @ts-ignore
                "x-displayName": "Users",
                summary: "Users",
                parent: "Admin API",
                description: "Endpoints for user management",
            },


            {
                name: "Mail Accounts",
                // @ts-ignore
                "x-displayName": "Mail Accounts",
                summary: "Mail Accounts",
                parent: "Mail",
                description: "Endpoints for managing mail accounts",
            },
            {
                name: "Mail Accounts / Identities",
                // @ts-ignore
                "x-displayName": "Mail Identities",
                summary: "Mail Identities",
                parent: "Mail Accounts",
                description: "Endpoints for managing mail identities",
            },
            {
                name: "Mail Accounts / Mailboxes",
                // @ts-ignore
                "x-displayName": "Mailboxes",
                summary: "Mailboxes",
                parent: "Mail Accounts",
                description: "Endpoints for managing mailboxes",
            },
            {
                name: "Mail Accounts / Mailboxes / Mails",
                // @ts-ignore
                "x-displayName": "Mails",
                summary: "Mails",
                parent: "Mail Accounts / Mailboxes",
                description: "Endpoints for managing mails",
            },
            {
                name: "Mail Accounts / Mailboxes / Mails / Attachments",
                // @ts-ignore
                "x-displayName": "Attachments",
                summary: "Mail Attachments",
                parent: "Mail Accounts / Mailboxes / Mails",
                description: "Endpoints for managing mail attachments",
            }
        ]
    }
}

export function setupDocs(app: Hono) {

    app.get(
        "/docs/openapi",
        openAPIRouteHandler(app, openAPIConfig),
    );

    app.get('/docs', Scalar({ url: '/docs/openapi', theme: 'purple' }));

}

export const DOCS_TAGS = {
    ACCOUNT: "Account",
    ACCOUNT_API_KEYS: "Account / API Keys",

    AUTHENTICATION: "Authentication",

    ADMIN_API: {
        BASE: "Admin API",

        USERS: "Admin API / Users",
    },

    MAIL_ACCOUNTS: {
        BASE: "Mail Accounts",
        IDENTITIES: "Mail Accounts / Identities",
        MAILBOXES: "Mail Accounts / Mailboxes",
        MAILBOXES_MAILS: "Mail Accounts / Mailboxes / Mails",
        MAILBOXES_MAILS_ATTACHMENTS: "Mail Accounts / Mailboxes / Mails / Attachments",
    }
}