import * as fs from 'fs-extra';
import * as path from 'path';
import { chdir } from 'process';
import { ChildProcess } from 'child_process';

import * as _ from 'lodash';
import * as promptly from 'promptly';
import * as rimraf from 'rimraf';
import * as tmp from 'tmp';
import * as xml2js from 'xml2js';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/toPromise';

import { spawn } from 'spawn-rx';

import { Environment } from './environment';
import { SDFConfig } from './sdf-config';
import { SdfCliJson } from './sdf-cli-json';
import { CLICommand } from './cli-command';
import { CustomObjects, CustomObject, CustomObjectTypes } from './custom-object';

const CustomObjectMap = _.reduce(CustomObjects, (acc, obj: CustomObject) => ({ ...acc, [obj.type]: obj }), {});

const Bluebird = require('bluebird');

export class NetSuiteSDF {
  activeEnvironment: Environment;
  addDefaultParameters = true;
  collectedData: string[] = [];
  currentObject: CustomObject;
  currentFunctionName: string;
  doAddProjectParameter = true;
  doReturnData = false;
  doSendPassword = true;
  doShowOutput = true;
  intervalId;
  // outputChannel: vscode.OutputChannel;
  password: string;
  rootPath: string;
  savedStatus: string;
  sdfcli: Observable<string>;
  sdfConfig: SDFConfig;
  sdfCliIsInstalled = true; // Prevents error messages while Code is testing SDFCLI is installed.
  splitObjectString = true;
  // statusBar: vscode.StatusBarItem;
  tempDir: tmp.SynchrounousResult;
  hasSdfCache: boolean;
  xmlBuilder = new xml2js.Builder({ headless: true });

  constructor() {
    this.checkSdfCliIsInstalled().then(() => {
      if (this.sdfCliIsInstalled) {
        // this.initializeStatusBar();
        // this.outputChannel = vscode.window.createOutputChannel('SDF');
      }
    });
  }

  // private initializeStatusBar() {
  //   this.statusBar = vscode.window.createStatusBarItem();
  //   this.statusBar.text = this.statusBarDefault;
  //   this.statusBar.tooltip = 'Click here to select your NetSuite environment';
  //   this.statusBar.command = 'extension.selectEnvironment';
  //   this.statusBar.show();
  // }

  get statusBarDefault() {
    if (this.activeEnvironment) {
      return `SDF (${this.activeEnvironment.name})`;
    } else {
      return 'SDF';
    }
  }

  /*********************/
  /** SDF CLI Commands */
  /*********************/

  async addDependencies() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doSendPassword = false;

    await this.getConfig();
    const projectName = this.sdfConfig.projectName || 'PROJECT_NAME_MISSING';
    const defaultXml = `
    <manifest projecttype="ACCOUNTCUSTOMIZATION">
      <projectname>${projectName}</projectname>
      <frameworkversion>1.0</frameworkversion>
    </manifest>
    `;
    fs.writeFile(path.join(this.rootPath, 'manifest.xml'), defaultXml, function(err) {
      if (err) throw err;
    });
    await this.runCommand(CLICommand.AddDependencies, '-all');
  }

  async createProject() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doSendPassword = false;
    this.addDefaultParameters = false;

    const pathPrompt = `Please enter your the parent directory to create the Project in`;
    const outputPath = await promptly.prompt(pathPrompt);
    if (outputPath) {
      const projectNamePrompt = `Please enter your project's name`;
      const projectName = await promptly.prompt(projectNamePrompt);
      if (projectName) {
        await this.runCommand(
          CLICommand.CreateProject,
          `-pd ${outputPath}`,
          `-pn ${projectName}`,
          '-t ACCOUNTCUSTOMIZATION'
        );
      }
    }
  }

  async _generateTempDeployDirectory() {
    const deployPath = path.join(this.rootPath, 'deploy.xml');
    const deployXmlExists = await this.fileExists(deployPath);
    if (!deployXmlExists) {
      this.setDefaultDeployXml();
    }
    const deployXml = await this.openFile(deployPath);
    const deployJs = await this.parseXml(deployXml);

    const files = _.get(deployJs, 'deploy.files[0].path', []);
    const objects = _.get(deployJs, 'deploy.objects[0].path', []);
    const allFiles = files.concat(objects).concat(['/deploy.xml', '/manifest.xml', '/.sdf']);

    this.tempDir = tmp.dirSync({ unsafeCleanup: true, keep: false });
    try {
      for (let filepath of allFiles) {
        if (_.includes(filepath, '*')) {
          // TODO: Add warning about globs
          continue;
        }
        filepath = filepath.replace('~', '');
        const fromPath = path.join(filepath);
        const toPath = path.join(this.tempDir.name, filepath);
        await this.copyFile(fromPath, toPath);
        console.log('wait');
      }
    } catch (e) {
      console.log(e);
    }
  }

  async deploy() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }
    await this.getConfig();

    // TODO: Add parameter to Snit for Quick Deploy
    const useQuickDeploy = _.get(this.sdfConfig, 'useQuickDeploy', true);
    if (useQuickDeploy) {
      await this._generateTempDeployDirectory();

      await this.runCommand(CLICommand.Deploy, '-np', '-sw');

      await rimraf(this.rootPath + '/var', (err: Error) => {
        // console.error(err.message);
      });
    } else {
      await this.runCommand(CLICommand.Deploy);
    }
  }

  importBundle() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    // TODO?
    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.ImportBundle);
  }

  // async importFiles() {
  //   if (!this.sdfCliIsInstalled) {
  //     console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
  //     return;
  //   }

  //   this.doAddProjectParameter = false;
  //   this.doReturnData = true;

  //   const collectedData = await this.listFiles();
  //   if (collectedData) {
  //     const filteredData = collectedData.filter(data => data.indexOf('SuiteScripts') >= 0);
  //     if (filteredData.length > 0) {
  //       const selectedFiles = await vscode.window.showQuickPick(filteredData, {
  //         canPickMany: true,
  //         ignoreFocusOut: true
  //       });
  //       if (selectedFiles && selectedFiles.length > 0) {
  //         this._importFiles(selectedFiles);
  //       }
  //     }
  //   }
  // }

  async _importFiles(files: string[]) {
    const cleanedFiles = _.map(files, file => `"${file}"`);
    const fileString = cleanedFiles.join(' ');
    return this.runCommand(CLICommand.ImportFiles, `-paths ${fileString}`);
  }

  // async importObjects(context?: any) {
  //   if (!this.sdfCliIsInstalled) {
  //     console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
  //     return;
  //   }

  //   const collectedData = await this.listObjects();
  //   if (collectedData) {
  //     const filteredData = collectedData.filter(data => data.indexOf('cust') >= 0);
  //     if (filteredData.length > 0) {
  //       const selectedObjects = await vscode.window.showQuickPick(filteredData, {
  //         canPickMany: true,
  //         ignoreFocusOut: true
  //       });
  //       if (selectedObjects && selectedObjects.length > 0) {
  //         this.createPath(this.currentObject.destination);
  //         this._importObjects(this.currentObject.type, selectedObjects, this.currentObject.destination);
  //       }
  //     }
  //   }
  // }

  async _importObjects(scriptType: string, scriptIds: string[], destination: string) {
    await this.createPath(destination);
    const scriptIdString = scriptIds.join(' ');
    return this.runCommand(
      CLICommand.ImportObjects,
      `-scriptid ${scriptIdString}`,
      `-type ${scriptType}`,
      `-destinationfolder ${destination}`
    );
  }

  issueToken() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.IssueToken);
  }

  listBundles() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.ListBundles);
  }

  listFiles() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doAddProjectParameter = false;
    return this.runCommand(CLICommand.ListFiles, '-folder /SuiteScripts');
  }

  listMissingDependencies() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doSendPassword = false;
    this.runCommand(CLICommand.ListMissingDependencies);
  }

  async listObjects(type_?: string) {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doAddProjectParameter = false;
    this.doReturnData = true;

    await this.getConfig();

    if (this.sdfConfig) {
      if (type_ === 'all') {
        this.splitObjectString = false;
        return this.runCommand(CLICommand.ListObjects);
      }

      if (type_) {
        if (!_.includes(CustomObjectTypes, type_)) {
          console.error(`Invalid custom object type: ${type_}`);
          return this.exit();
        }
      } else {
        // this.currentObject = await vscode.window.showQuickPick(CustomObjects, {
        //   ignoreFocusOut: true
        // });
        // type_ = this.currentObject.type;
      }
      if (type_) {
        return this.runCommand(CLICommand.ListObjects, `-type ${this.currentObject.type}`);
      }
    }
  }

  async preview() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }
    await this.getConfig();

    // TODO: Add parameter to Snit for Quick Deploy
    const useQuickDeploy = _.get(this.sdfConfig, 'useQuickDeploy', true);
    if (useQuickDeploy) {
      await this._generateTempDeployDirectory();

      await this.runCommand(CLICommand.Preview);

      await rimraf(this.rootPath + '/var', (err: Error) => {
        // console.error(err.message);
      });
    } else {
      await this.runCommand(CLICommand.Preview);
    }
  }

  revokeToken() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.RevokeToken);
  }

  saveToken(tokenId?: string, tokenSecret?: string) {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.SaveToken, `-tokenid ${tokenId}`, `-tokensecret ${tokenSecret}`);
  }

  async getFiles() {
    await this.getConfig();
    if (this.sdfConfig) {
      const files = await this.listFiles();
      if (files) {
        console.log('Synchronizing SuiteScript folder.');
        await this._importFiles(files);
      }
    } else {
      return;
    }
  }

  getObjectFunc = (object: CustomObject, objects: string[]) => async () => {
    //Saved Searches should not be supported at this time.
    if (object.type === 'savedsearch') return;

    this.doAddProjectParameter = true;
    this.doReturnData = true;

    await this.getConfig();
    if (this.sdfConfig) {
      if (objects.length > 0) {
        const cleanedObjects = _.map(objects, obj => obj.split(':')[1]);
        console.log('Synchronizing ' + object.type);

        // const objectsChunked = _.chunk(cleanedObjects, 10);

        // for (let i = 0; i < objectsChunked.length; i++) {
        //   await this._importObjects(object.type, objectsChunked[i], object.destination);
        // }
        await this._importObjects(object.type, cleanedObjects, object.destination);
      }
    }
  };

  // async update() {
  //   if (!this.sdfCliIsInstalled) {
  //     console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
  //     return;
  //   }

  //   await this.getConfig();
  //   const objectsRecordPath = path.join(this.rootPath, 'Objects');
  //   const pathExists = await this.fileExists(objectsRecordPath);

  //   if (pathExists) {
  //     const filePathList = await this.getXMLFileList(['Objects'], this.rootPath);

  //     if (filePathList.length > 0) {
  //       const shortNames = filePathList.map(file => file.path.substr(file.path.indexOf('Objects') + 8));
  //       const selectionArr = await vscode.window.showQuickPick(shortNames, {
  //         canPickMany: true
  //       });

  //       if (selectionArr && selectionArr.length > 0) {
  //         const selectedFile = filePathList.filter(file => {
  //           for (const selection of selectionArr) {
  //             if (file.path.indexOf(selection) >= 0) {
  //               return true;
  //             }
  //           }
  //         });
  //         const selectionStr = selectedFile
  //           .map(file => file.scriptid.substring(0, file.scriptid.indexOf('.')))
  //           .join(' ');
  //         this.runCommand(CLICommand.Update, `-scriptid ${selectionStr}`);
  //       }
  //     }
  //   }
  // }

  // async updateCustomRecordWithInstances() {
  //   if (!this.sdfCliIsInstalled) {
  //     console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
  //     return;
  //   }

  //   await this.getConfig();
  //   const customRecordPath = path.join(this.rootPath, '/Objects/Records');
  //   const pathExists = await this.fileExists(customRecordPath);
  //   if (pathExists) {
  //     const rawFileList = await this.ls(customRecordPath);
  //     const fileList = rawFileList.map((filename: string) => filename.slice(0, -4));

  //     if (fileList) {
  //       const objectId = await vscode.window.showQuickPick(fileList, {
  //         ignoreFocusOut: true
  //       });
  //       if (objectId) {
  //         this.runCommand(CLICommand.UpdateCustomRecordsWithInstances, `-scriptid ${objectId}`);
  //       }
  //     }
  //   } else {
  //     console.error('No custom records found in /Objects/Records. Import Objects before updating with custom records.');
  //   }
  // }

  // THIS EXISTS IN OTHER REPO:
  // async uploadFolders(context?: any) {
  //   if (context && context.scheme !== 'folder') {
  //     console.error(`${context.fsPath} is not a folder.`);
  //     return;
  //   }

  //   const files = vscode.workspace.findFiles('*.*');
  //   console.log(files);
  // }

  validate() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    this.runCommand(CLICommand.Validate);
  }

  /************************/
  /** Extension Commands **/
  /************************/

  // async addFileToDeploy() {
  //   if (context && context.scheme !== 'file') {
  //     console.error(`Unknown file type '${context.scheme}' to add to deploy.xml`);
  //     return;
  //   }
  //   await this.getConfig();
  //   const deployPath = path.join(this.rootPath, 'deploy.xml');

  //   let currentFile: string;
  //   if (context && context.fsPath) {
  //     currentFile = context.fsPath;
  //   } else {
  //     currentFile = vscode.window.activeTextEditor.document.fileName;
  //   }

  //   const isScript = _.includes(currentFile, path.join(this.rootPath, '/FileCabinet/SuiteScripts'));
  //   const isObject = _.includes(currentFile, path.join(this.rootPath, '/Objects'));

  //   if (!isScript && !isObject) {
  //     console.error('Invalid file to add to deploy.xml. File was not a Script or an Object.');
  //     return;
  //   }
  //   const xmlPath = isScript ? 'deploy.files[0].path' : 'deploy.objects[0].path';
  //   const relativePath = _.replace(currentFile, this.rootPath, '~');

  //   const deployXmlExists = await this.fileExists(deployPath);
  //   if (!deployXmlExists) {
  //     this.setDefaultDeployXml();
  //   }
  //   const deployXml = await this.openFile(deployPath);
  //   const deployJs = await this.parseXml(deployXml);
  //   const elements = _.get(deployJs, xmlPath, []);
  //   if (_.includes(elements, relativePath)) {
  //     console.log('File/Object already exists in deploy.xml.');
  //   } else {
  //     elements.push(relativePath);
  //     _.set(deployJs, xmlPath, elements);

  //     const newXml = this.xmlBuilder.buildObject(deployJs);
  //     fs.writeFile(deployPath, newXml, function(err) {
  //       if (err) throw err;
  //       console.log('Added File/Object to deploy.xml.');
  //     });
  //   }
  // }

  refreshConfig() {
    this.getConfig({ force: true });
  }

  async removeFolders() {
    await this.getConfig();

    if (this.sdfConfig) {
      console.log('Emptying: ' + this.rootPath + '/Objects/');
      await rimraf(this.rootPath + '/Objects/*', (err: Error) => {
        console.error(err);
      });
      console.log('Emptying: ' + this.rootPath + '/FileCabinet/SuiteScripts/');
      await rimraf(this.rootPath + '/FileCabinet/SuiteScripts/*', (err: Error) => {
        console.error(err);
      });
    }
  }

  async resetPassword() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    const _resetPassword = async () => {
      const prompt = `Please enter your password for your ${this.activeEnvironment.name} account.`;
      const password = await promptly.password(prompt);
      this.password = password;
    };

    if (this.sdfConfig) {
      await _resetPassword();
    } else {
      await this.getConfig({ force: true });
      await _resetPassword();
    }
  }

  async selectEnvironment() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    const _selectEnvironment = async () => {
      if (this.currentFunctionName === 'setEnvironment') {
        return;
      }
      try {
        const environments = this.sdfConfig.environments.reduce((acc, curr: Environment) => {
          acc[curr.name] = curr;
          return acc;
        }, {});
        const environmentNames = Object.keys(environments);

        const activeEnvironments = _.filter(environments, (env: Environment, name: string) => env.active);
        if (activeEnvironments) {
          const activeName = activeEnvironments[0].name;
          console.log(`Found active environment in .sdfcli.json. Using first one found: ${activeName}`);
          this.activeEnvironment = environments[activeName];
          return;
        }

        if (environmentNames.length === 1) {
          const environmentName = environmentNames[0];
          this.activeEnvironment = environments[environmentName];
          // this.statusBar.text = this.statusBarDefault;
          console.log(`Found only one environment. Using ${environmentName}`);
        } else {
          const environmentName = await promptly.choose(
            `Please type an environment name [${environmentNames.join(', ')}]:\n`,
            environmentNames
          );
          if (environmentName) {
            this.activeEnvironment = environments[environmentName];
            if (this.activeEnvironment.account === '00000000') {
              console.error('.sdfcli.json account number appears to be wrong. Are you still using the blank template?');
              this.sdfConfig = undefined;
              this.activeEnvironment = undefined;
              // this.clearStatus();
            } else {
              // this.statusBar.text = this.statusBarDefault;
            }
          }
        }
      } catch (e) {
        console.error('Unable to parse .sdfcli.json environments. Please check repo for .sdfcli.json formatting.');
        // this.clearStatus();
      }
    };

    if (this.sdfConfig) {
      await _selectEnvironment();
    } else {
      await this.getConfig({ force: true });
    }
  }

  setDefaultDeployXml() {
    const defaultXml = `<deploy></deploy>`;
    fs.writeFile(path.join(this.rootPath, 'deploy.xml'), defaultXml, function(err) {
      if (err) throw err;
    });
  }

  async setEnvironment(env: string) {
    this.currentFunctionName = 'setEnvironment';
    await this.getConfig();

    const environments = this.sdfConfig.environments.reduce((acc, curr: Environment) => {
      acc[curr.name] = curr;
      return acc;
    }, {});

    if (!(env in environments)) {
      console.error(`Unknown environment: ${env}`);
      this.exit();
    }

    this.activeEnvironment = environments[env];
    console.log(`Setting active environment: ${env}. Saving .sdfcli.json`);
    try {
      const sdfEnvironments = this.sdfConfig.environments;
      const noActiveEnvironments = _.map(sdfEnvironments, (environment: Environment) => {
        delete environment.active;
        return environment;
      });
      const withActiveEnvironment = _.map(noActiveEnvironments, (environment: Environment) => {
        if (environment.name === env) {
          environment.active = true;
        }
        return environment;
      });
      this.sdfConfig.environments = withActiveEnvironment;
      fs.writeFile(path.join(this.rootPath, '.sdfcli.json'), JSON.stringify(this.sdfConfig, null, 4), function(err) {
        if (err) throw err;
      });
    } catch (e) {
      console.log(e);
    }

    this.cleanup();
  }

  async sync() {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }
    try {
      await this.getConfig();
    } catch (e) {
      console.error('Unable to fetch config. Aborting.');
      this.exit(1);
    }

    try {
      await this.removeFolders();
    } catch (e) {
      console.error('Unable to clear folders. Aborting.');
      this.exit(1);
    }

    try {
      if (this.sdfConfig) {
        const allCustomObjects = await this.listObjects('all');
        const objectGroups = _.groupBy(allCustomObjects, objectString => objectString.split(':')[0]);
        const objectCommands = _.map(objectGroups, (objects: string[], type_: string) => {
          const obj = CustomObjectMap[type_];
          return this.getObjectFunc(obj, objects); // Returns a lazy closure
        });
        await this.getFiles();
        await Bluebird.map(objectCommands, func => func(), { concurrency: 10 });
        console.log('Synchronization complete!');
        this.exit();
      }
    } catch (e) {
    } finally {
      this.cleanup();
    }
  }

  /*********************/
  /** VS Code Helpers **/
  /*********************/

  async checkSdfCliIsInstalled() {
    try {
      // Don't like this. There must be a better way.
      const thread = await spawn('sdfcli').toPromise();
      this.sdfCliIsInstalled = true;
    } catch (e) {
      this.sdfCliIsInstalled = false;
      if (e.code === 'ENOENT') {
        console.error("'sdfcli' not found in path! Check repo for install directions.");
      } else {
        throw e;
      }
    }
  }

  cleanup() {
    // Clean up default instance variables (or other matters) after thread closes.
    if (!this.doReturnData) {
      this.collectedData = [];
      this.currentObject = undefined;
    }
    clearInterval(this.intervalId);
    // this.clearStatus();

    this.doAddProjectParameter = true;
    this.doReturnData = false;
    this.doSendPassword = true;
    this.intervalId = undefined;
    this.sdfcli = undefined;
    this.doShowOutput = true;
    if (this.tempDir && this.tempDir.name !== '') {
      this.tempDir.removeCallback();
    }
    this.tempDir = undefined;
    this.addDefaultParameters = true;
    this.splitObjectString = true;
    this.currentFunctionName = undefined;
  }

  // clearStatus() {
  //   if (this.savedStatus) {
  //     this.statusBar.text = this.savedStatus;
  //     this.savedStatus = undefined;
  //   } else {
  //     this.statusBar.text = this.statusBarDefault;
  //   }
  // }

  async getConfig({ force = false }: { force?: boolean } = {}) {
    if (!this.sdfCliIsInstalled) {
      console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
      return;
    }

    if (force || !this.sdfConfig) {
      this.rootPath = process.cwd();

      const sdfTokenPath = path.join(this.rootPath, '.clicache');
      const sdfCacheExists = await this.fileExists(sdfTokenPath);

      if (sdfCacheExists) {
        this.hasSdfCache = true;
      }

      const sdfPath = path.join(this.rootPath, '.sdfcli.json');
      const sdfPathExists = await this.fileExists(sdfPath);
      if (sdfPathExists) {
        const buffer = await this.openFile(path.join(this.rootPath, '.sdfcli.json'));
        const jsonString = buffer.toString();
        try {
          this.sdfConfig = JSON.parse(jsonString);
          await this.selectEnvironment();
        } catch (e) {
          console.error(`Unable to parse .sdfcli.json file found at project root: ${this.rootPath}`);
        }
      } else {
        fs.writeFileSync(path.join(this.rootPath, '.sdfcli.json'), SdfCliJson);
        console.error(
          `No .sdfcli.json file found at project root: ${this.rootPath}. Generated a blank .sdfcli.json template.`
        );
        this.exit(1);
      }
    } else if (!this.activeEnvironment) {
      await this.selectEnvironment();
    }
  }

  handlePassword(line: string, command: CLICommand, stdinSubject: Subject<string>) {
    if (line.startsWith('Enter password:')) {
      line = line.substring(15);
    }
    if (line.includes('You have entered an invalid email address or password. Please try again.')) {
      this.password = undefined;
      console.error('Invalid email or password. Be careful! Too many attempts will lock you out!');
    }
    return line;
  }

  async handleStdIn(line: string, command: CLICommand, stdinSubject: Subject<string>) {
    switch (true) {
      case line.includes('Using user credentials.') && this.doSendPassword:
        if (!this.password) {
          await this.resetPassword();
        }
        stdinSubject.next(`${this.password}\n`);
        break;
      case line.includes('WARNING! You are deploying to a Production account, enter YES to continue'):
        const prompt = "Please type 'Deploy' to deploy to production.";
        const answer = await promptly.prompt(prompt);
        if (answer === 'Deploy') {
          stdinSubject.next('YES\n');
        } else {
          console.log('Cancelling deployment.\n');
          stdinSubject.next('NO\n');
        }
        break;
      case line.includes('Type YES to continue'):
      case line.includes('enter YES to continue'):
      case line.includes('Type YES to update the manifest file'):
      case line.includes('Proceed with deploy?'):
      case line.includes('Type Yes (Y) to continue.'):
        stdinSubject.next('YES\n');
        break;
      default:
        break;
    }
  }

  async handleStdOut(line: string, command: CLICommand) {
    switch (true) {
      case line.includes('That record does not exist.'):
        break;
      case line.includes('does not exist.'):
        console.error('Custom record does not exist for updating. Please Import Object first.');
      case line.includes('Installation COMPLETE'):
        console.log('Installation of deployment was completed.');
      default:
        break;
    }
  }

  mapCommandOutput(command: CLICommand, line: string) {
    switch (command) {
      case CLICommand.ListObjects:
        if (this.splitObjectString) {
          return line.includes(':') ? line.split(':')[1] : line;
        } else {
          return line;
        }
      default:
        return line;
    }
  }

  async runCommand(command: CLICommand, ...args): Promise<any> {
    await this.getConfig();
    if (
      this.sdfConfig &&
      this.activeEnvironment
      // (this.password || this.hasSdfCache) // No need if using tokens
    ) {
      if (this.doShowOutput) {
        // this.outputChannel.show();
      }

      let workPath = this.rootPath;
      if (this.tempDir) {
        workPath = path.join(workPath, this.tempDir.name);
      }

      let commandArray: string[] = [command];
      if (this.addDefaultParameters) {
        commandArray = commandArray.concat([
          `-account ${this.activeEnvironment.account}`,
          `-email ${this.activeEnvironment.email}`,
          `-role ${this.activeEnvironment.role}`,
          `-url ${this.activeEnvironment.url}`
        ]);
      }

      if (this.doAddProjectParameter) {
        commandArray.push(`-p ${workPath}`);
      }
      for (let arg of args) {
        commandArray.push(arg);
      }

      const stdinSubject = new Subject<string>();

      this.sdfcli = spawn('sdfcli', commandArray, {
        cwd: workPath,
        stdin: stdinSubject,
        windowsVerbatimArguments: true
      });

      this.showStatus();

      let streamWrapper = Observable.create(observer => {
        let acc = '';

        return this.sdfcli.subscribe(
          value => {
            acc = acc + value;
            let lines = acc.split('\n');

            // Check if the last line is a password entry line - this is only an issue with Object and File imports
            const endingPhrases = ['Enter password:'];
            const endingLine = lines.filter(line => {
              for (let phrase of endingPhrases) {
                return line === phrase;
              }
            });
            for (let line of lines.slice(0, -1).concat(endingLine)) {
              observer.next(line);
            }
            acc = endingLine.length > 0 ? '' : lines[lines.length - 1];
          },
          error => observer.error(error),
          () => observer.complete()
        );
      });

      const collectedData = await streamWrapper
        .map(line => this.handlePassword(line, command, stdinSubject))
        .do(line => (this.doShowOutput ? console.log(`${line}`) : null))
        .do(line => this.handleStdIn(line, command, stdinSubject))
        .do(line => this.handleStdOut(line, command))
        .filter(
          line =>
            !(
              !line ||
              line.startsWith('[INFO]') ||
              line.startsWith('SuiteCloud Development Framework CLI') ||
              line.startsWith('Done.') ||
              line.startsWith('Using ')
            )
        )
        .map(line => this.mapCommandOutput(command, line))
        .reduce((acc: string[], curr: string) => acc.concat([curr]), [])
        .toPromise()
        .catch(err => this.cleanup());

      this.cleanup();
      return collectedData;
    }
  }

  showStatus() {
    // this.savedStatus = this.statusBar.text;
    const mode1 = ' [= ]';
    const mode2 = ' [ =]';
    let currentMode = mode1;
    this.intervalId = setInterval(() => {
      currentMode = currentMode === mode1 ? mode2 : mode1;
      // this.statusBar.text = this.savedStatus + currentMode;
    }, 500);
  }

  /**************/
  /*** UTILS ****/
  /**************/

  async copyFile(relativeFrom: string, relativeTo: string) {
    const toDir = relativeTo
      .split('/')
      .slice(0, -1)
      .join('/');
    this.createPath(toDir);
    const from = path.join(this.rootPath, relativeFrom);
    const to = path.join(this.rootPath, relativeTo);
    return fs.copyFile(from, to);
  }

  createPath(targetDir) {
    // Strip leading '/'
    targetDir = targetDir.substring(1);
    const initDir = this.rootPath;
    const baseDir = this.rootPath;

    targetDir.split('/').reduce((parentDir, childDir) => {
      const curDir = path.resolve(baseDir, parentDir, childDir);
      try {
        fs.mkdirSync(curDir);
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }

      return curDir;
    }, initDir);
  }

  fileExists(path: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        fs.exists(path, exists => resolve(exists));
      } catch (e) {
        reject(e);
      }
    });
  }

  openFile(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      fs.readFile(path, (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      });
    });
  }

  ls(path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      fs.readdir(path, (err, items) => {
        if (err) {
          reject(err);
        }
        resolve(items);
      });
    });
  }

  parseXml(xml: string): Promise<{ [key: string]: any }> {
    return new Promise((resolve, reject) => {
      xml2js.parseString(xml, function(err, result) {
        if (err) {
          reject(err);
        }
        resolve(result);
      });
    });
  }

  async getXMLFileList(dirList: string[], root: string): Promise<{ path: string; scriptid: string }[]> {
    const fileList: { path: string; scriptid: string }[] = [];
    const traverseFolders = async (folders: string[], root: string) => {
      if (folders.length > 0) {
        for (const folder of folders) {
          const rawFileList = await this.ls(path.join(root, folder));
          const dirList: string[] = [];
          for (const fileName of rawFileList) {
            const lstat = fs.lstatSync(path.join(root, folder, fileName));
            if (lstat.isDirectory()) {
              dirList.push(fileName);
            } else {
              if (fileName.slice(fileName.length - 4) === '.xml') {
                fileList.push({
                  path: path.join(root, folder, fileName),
                  scriptid: fileName
                });
              }
            }
          }
          await traverseFolders(dirList, path.join(root, folder));
        }
      } else {
        return folders;
      }
    };
    try {
      await traverseFolders(dirList, root);
      return fileList;
    } catch (err) {
      console.error('Unable to get file list: ', err.message);
    }
  }

  exit(code = 0) {
    process.exit(code);
  }
}
