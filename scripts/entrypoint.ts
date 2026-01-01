
process.env["DLA_DB_AUTO_MIGRATE"] = "true";

await import("../src/index");

export {};