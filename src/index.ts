#!/usr/bin/env node

import { ArgumentParser } from 'argparse';

import { NetSuiteSDF } from './netsuite-sdf';
import { SnitArguments } from './snit-arguments';
import { Subcommand } from './subcommands';

function parseArguments(): SnitArguments {
  const parser = new ArgumentParser({
    version: '0.0.1',
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

async function runOptions(args: SnitArguments) {
  const sdf = new NetSuiteSDF();

  if (args.environment) {
    await sdf.setEnvironment(args.environment);
  } else if (args.listfiles) {
    await sdf.listFiles();
  } else if (args.listobjects) {
    await sdf.listObjects(args.listobjects);
    // } else if (args.subcommand === Subcommand.SaveToken) {
    //   await sdf.saveToken(args.tokenid, args.secret);
  } else if (args.sync) {
    await sdf.sync();
  }
}

function main() {
  const args: SnitArguments = parseArguments();
  runOptions(args).catch(err => console.error(err));
}

if (require.main === module) {
  main();
}
