import { Subcommand } from './subcommands';

export interface SnitArguments {
  deploy: boolean;
  environment: string;
  listobjects: string;
  listfiles: boolean;
  sync: boolean;

  subcommand: Subcommand;

  // savetoken subcommand options
  tokenid?: string;
  secret?: string;
}
