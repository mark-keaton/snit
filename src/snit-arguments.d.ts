import { Subcommand } from './subcommands';

export interface SnitArguments {
  environment: string;
  listobjects: string;
  listfiles: boolean;
  sync: boolean;

  subcommand: Subcommand;

  // savetoken subcommand options
  tokenid?: string;
  secret?: string;
}
