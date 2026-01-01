import { Logger } from "../utils/logger";
import { authMiddleware } from "./middleware/auth";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { setupDocs } from "./docs";
import { cors } from "hono/cors";
import { HTTPException } from 'hono/http-exception'

export class API {

	protected static server: Bun.Server<undefined>;
	protected static app: Hono;

	protected static routers = [
		(import('./routes/auth')),
		(import('./routes/account')),
		(import('./routes/admin'))
	];

	static async init(
		frontendUrls: string[] = []
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
				const res = err.getResponse();
				let body: any;

				try {
					// Hono puts zod issues into the response body
					body = JSON.parse(await res.text())
				} catch {
					body = { error: 'Invalid input' }
				}

				return c.json({
					success: false,
					message: 'Your input is invalid',
					details: body
				}, err.status)
			}

			Logger.error("API Error:", err);
			return c.json({ success: false, message: 'Internal Server Error' }, 500);
		})


		// Apply global auth middleware
		this.app.use(authMiddleware);

		for (const router of this.routers) {
			this.app.route("/", (await router).router);
		}

		this.app.get("/health", (c) => {
			return c.json({ status: "Delivr API is running" });
		});

        this.app.get("/", (c) => {
            return c.redirect("/docs");
        });

		setupDocs(this.app);

	}

	static async start(port: number, hostname: string) {

		if (!this.app) {
			await this.init();
		}

		this.server = Bun.serve({ port, hostname, fetch: this.app.fetch });

		Logger.log(`API is running at ${this.server?.hostname}:${this.server?.port}`);
	}

	static async stop() {
		if (this.server) {
			this.server.stop();
			Logger.log("API server stopped.");
		}
	}

	static getApp(): typeof API.app {
		if (!this.app) {
			throw new Error("API not initialized. Call API.init() first.");
		}
		return this.app;
	}

}