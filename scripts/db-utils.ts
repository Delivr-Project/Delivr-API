import { existsSync, mkdirSync } from "fs"

if (!existsSync("./data/")) {
    mkdirSync("./data/")
}
