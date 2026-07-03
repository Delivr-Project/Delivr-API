import { Hono } from "hono";
import type { GenerateSpecOptions } from "hono-openapi";
import { HonoBase } from "hono/hono-base";

export abstract class APIVersionRouter<T extends APIVersionRouter.InitSettings = APIVersionRouter.InitSettings> {

    readonly version: number;
    readonly openAPIConfig: Readonly<APIVersionRouter.OpenAPIConfig>;
    readonly router: HonoBase;

    protected constructor(settings: Readonly<T>) {
        this.version = settings.version;
        this.openAPIConfig = settings.openAPIConfig;

        if (settings.routes instanceof HonoBase) {

            this.router = settings.routes;

        } else if (Array.isArray(settings.routes)) {

            this.router = new Hono();

            for (const route of (settings.routes as Array<{ router: HonoBase } | HonoBase>)) {

                if (route instanceof HonoBase) {
                    this.router.route("/", route);
                }
                else if ('router' in route && route.router instanceof HonoBase) {
                    this.router.route("/", route.router);
                }
                else {
                    console.error("Invalid route configuration: Each route must be a Hono instance or an object with a 'router' property that is a Hono instance.", route);
                    throw new Error("Invalid route configuration: Each route must be a Hono instance or an object with a 'router' property that is a Hono instance.");
                }
            }
        } else {
            throw new Error("Invalid route configuration: 'routes' must be either a Hono instance or an array of Hono instances or objects with a 'router' property that is a Hono instance.");
        }
    }

}

export namespace APIVersionRouter {

    export interface InitSettings {
        version: number;
        openAPIConfig: OpenAPIConfig;
        routes: Routable;
    }

    export type OpenAPIConfig = Partial<GenerateSpecOptions>;
    
    export type Routable = HonoBase | Array<{ router: HonoBase } | HonoBase>;

}

