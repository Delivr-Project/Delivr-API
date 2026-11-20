import { describe, expect, test } from "bun:test";
import { API } from "../src/api";

describe("JMAP", () => {
    test("requires authentication for session discovery", async () => {
        const response = await API.getApp().request("/.well-known/jmap");
        expect(response.status).toBe(401);
    });

    test("requires authentication for the method API", async () => {
        const response = await API.getApp().request("/jmap/api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([])
        });
        expect(response.status).toBe(401);
    });
});
