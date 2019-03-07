import { Environment } from './environment';

interface Options {
  useQuickDeploy: boolean;
}

export interface SDFConfig {
  projectName: string;
  environments: Environment[];
  options: Options;
}
