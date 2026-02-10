import { CLIApp, type CLIBaseCommand, type CLICommandArg, type CLICommandContext } from "@cleverjs/cli";
import { CompileAllCMD, CompileToTargetCMD } from "./compileCMD";
import { Platforms } from "./compiler";

class CompileCMD extends CLIApp {

    protected async run_help(): Promise<void> {
        console.log("Usage: bun compile [<platform> | auto | all] [<version>] [--no-version-tag]");
        console.log("Platforms: " + Object.keys(Platforms).join(", "));
    }

    override async dispatch(args: string[], ctx: CLICommandContext) {
        const cmd_name = args[0] as string | undefined;

        if (!cmd_name) {
            return (this.registry.get(["auto"] as any) as CLIBaseCommand).run({ args: {}, flags: {} }, ctx);
        }

        ctx.raw_parent_args.push("bun", "compile");

        return super.dispatch(args, ctx);
    }

};


await new CompileCMD()
    .register(new CompileToTargetCMD())
    .register(new CompileAllCMD())

    .handle(process.argv.slice(2), "shell");
