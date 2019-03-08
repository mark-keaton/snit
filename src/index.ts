import { ArgumentParser } from 'argparse';

import { NetSuiteSDF } from './netsuite-sdf';
import { SnitArguments } from './snit-arguments';

function parseArguments(): SnitArguments {
  const parser = new ArgumentParser({
    version: '0.0.1',
    addHelp: true,
    description: 'snit - sdfcli command line wrapper'
  });
  parser.addArgument(['-lf', '--listfiles'], {
    action: 'storeTrue',
    help: 'List all files in File Cabinet'
  });
  parser.addArgument(['-lo', '--listobjects'], {
    help: "List custom objects (e.g., 'restlet' or 'all')",
    nargs: 1,
    type: 'string',
    metavar: 'TYPE'
  });
  parser.addArgument(['-s', '--sync'], {
    action: 'storeTrue',
    help: 'Empty objects and file cabinet to copy state from environment'
  });
  const args = parser.parseArgs();
  return args;
}

async function runOptions(args: SnitArguments) {
  const sdf = new NetSuiteSDF();

  if (args.listfiles) {
    await sdf.listFiles();
  } else if (args.listobjects && args.listobjects.length > 0) {
    await sdf.listObjects(args.listobjects[0]);
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
