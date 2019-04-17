#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const argparse_1 = require("argparse");
const netsuite_sdf_1 = require("./netsuite-sdf");
function parseArguments() {
    const parser = new argparse_1.ArgumentParser({
        version: '0.0.2',
        addHelp: true,
        description: 'snit - sdfcli command line wrapper'
    });
    // const subparsers = parser.addSubparsers({
    //   title: 'subcommands',
    //   dest: 'subcommand'
    // });
    parser.addArgument(['-e', '--environment'], {
        action: 'store',
        type: 'string',
        help: 'Specify the active environment in .sdfcli.json'
    });
    parser.addArgument(['-lf', '--listfiles'], {
        action: 'storeTrue',
        help: 'List all files in File Cabinet'
    });
    parser.addArgument(['-lo', '--listobjects'], {
        help: "List custom objects (e.g., 'restlet' or 'all')",
        type: 'string',
        metavar: 'TYPE'
    });
    parser.addArgument(['-s', '--sync'], {
        action: 'storeTrue',
        help: 'Empty objects and file cabinet to copy state from environment'
    });
    // Subcommands are messing up the rest of the parser
    // Mayber refactor everything to subcommand
    // const saveTokenParser = subparsers.addParser('savetoken', {
    //   aliases: ['st'],
    //   addHelp: true
    // });
    // saveTokenParser.addArgument(['-id', '--tokenid'], {
    //   help: 'Access token id'
    // });
    // saveTokenParser.addArgument(['-sc', '--secret'], {
    //   help: 'Access token secret'
    // });
    const args = parser.parseArgs();
    return args;
}
function runOptions(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const sdf = new netsuite_sdf_1.NetSuiteSDF();
        if (args.environment) {
            yield sdf.setEnvironment(args.environment);
        }
        else if (args.listfiles) {
            yield sdf.listFiles();
        }
        else if (args.listobjects) {
            yield sdf.listObjects(args.listobjects);
            // } else if (args.subcommand === Subcommand.SaveToken) {
            //   await sdf.saveToken(args.tokenid, args.secret);
        }
        else if (args.sync) {
            yield sdf.sync();
        }
    });
}
function main() {
    const args = parseArguments();
    runOptions(args).catch(err => console.error(err));
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=index.js.map