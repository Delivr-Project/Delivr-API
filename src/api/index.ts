import { Logger } from "../utils/logger";
import { authMiddlewareV1 } from "./versions/v1/middleware/auth";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import { HTTPException } from 'hono/http-exception'
import type { APIVersionRouter } from "./utils/apiVersionRouter";
import { openAPIRouteHandler } from "hono-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { APIv1Router } from "./versions/v1";

export class API {

	protected static server: Bun.Server<undefined>;
	protected static app: Hono;

	protected static latestVersion: number | null = null;

	protected static registerVersion(versionRouter: APIVersionRouter, disableDocs: boolean = false) {

		this.app.route(`/v${versionRouter.version}`, versionRouter.router);

		if (!this.latestVersion || versionRouter.version > this.latestVersion) {
			this.latestVersion = versionRouter.version;
		}

		if (!disableDocs) {

			this.app.get(
				`/docs/v${versionRouter.version}/openapi`,
				openAPIRouteHandler(versionRouter.router, versionRouter.openAPIConfig),
			);

			this.app.get(
				`/docs/v${versionRouter.version}`,
				Scalar({ url: `/docs/v${versionRouter.version}/openapi` })
			);

		}
	}

	static async init(
		frontendUrls: string[] = [],
		disableDocs = false
	) {

		this.app = new Hono();

		this.app.use(prettyJSON())

		this.app.use('*', cors({
			origin: frontendUrls,
			allowHeaders: ['Content-Type', 'Authorization'],
			allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			maxAge: 600,
			credentials: true,
		}))

		this.app.onError(async (err, c) => {
			if (err instanceof HTTPException) {
				// Return only safe error metadata — never leak Zod validation details
				return c.json({
					success: false,
					code: err.status,
					message: 'Your input is invalid',
				}, err.status)
			}

			// this would potentially leak sensitive information, so we catch it here and return a generic error message instead of the default Hono error response which includes the error message and stack trace in development mode.
			// if (err instanceof HTTPException) {
			// 	const res = err.getResponse();
			// 	let body: any;

			// 	try {
			// 		// Hono puts zod issues into the response body
			// 		body = JSON.parse(await res.text())
			// 	} catch {
			// 		body = { error: 'Invalid input' }
			// 	}

			// 	return c.json({
			// 		success: false,
			// 		code: res.status,
			// 		message: 'Your input is invalid',
			// 		data: body
			// 	}, err.status)
			// }

			Logger.error("API Error:", err);
			return c.json({ success: false, code: 500, message: 'Internal Server Error' }, 500);
		});

		this.registerVersion(new APIv1Router, disableDocs);

		this.app.get("/health", (c) => {
			return c.json({
				success: true,
				code: 200,
				message: "Delivr API is running",
				data: null
			});
		});

		if (!disableDocs) {

			this.app.get("/", (c) => {
				return c.redirect(`/docs/v${this.latestVersion}`);
			});

		} else {

			this.app.get("/", (c) => {
				return c.json({
					success: true,
					code: 200,
					message: "Delivr API is running. Documentation is disabled.",
					data: null
				});
			});
		}

	}

	static async start(port: number, hostname: string) {

		if (!this.app) {
			await this.init();
		}

		this.server = Bun.serve({ port, hostname, fetch: this.app.fetch });

		Logger.log(`Delivr API is running at ${this.server?.hostname}:${this.server?.port}`);
	}

	static async stop() {
		if (this.server) {
			this.server.stop();
			Logger.log("Delivr API server stopped.");
		}
	}

	static getApp(): typeof API.app {
		if (!this.app) {
			throw new Error("Delivr API not initialized. Call API.init() first.");
		}
		return this.app;
	}

}