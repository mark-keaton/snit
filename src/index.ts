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
  parser.addArgument(['-s', '--sync'], {
    action: 'storeTrue',
    help: 'Empty objects and file cabinet to copy state from environment'
  });
  // parser.addArgument(['-b', '--bar'], {
  //   help: 'bar foo'
  // });
  // parser.addArgument('--baz', {
  //   help: 'baz bar'
  // });
  const args = parser.parseArgs();
  return args;
}

async function runOptions(args: SnitArguments) {
  const sdf = new NetSuiteSDF();

  if (args.listfiles) {
    await sdf.listFiles();
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
