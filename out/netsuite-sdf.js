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
const fs = require("fs-extra");
const path = require("path");
const _ = require("lodash");
const promptly = require("promptly");
const rimraf = require("rimraf");
const tmp = require("tmp");
const xml2js = require("xml2js");
const Observable_1 = require("rxjs/Observable");
const Subject_1 = require("rxjs/Subject");
require("rxjs/add/operator/do");
require("rxjs/add/operator/filter");
require("rxjs/add/operator/map");
require("rxjs/add/operator/toPromise");
const spawn_rx_1 = require("spawn-rx");
const sdf_cli_json_1 = require("./sdf-cli-json");
const cli_command_1 = require("./cli-command");
const custom_object_1 = require("./custom-object");
const CustomObjectMap = _.reduce(custom_object_1.CustomObjects, (acc, obj) => (Object.assign({}, acc, { [obj.type]: obj })), {});
const Bluebird = require('bluebird');
class NetSuiteSDF {
    constructor() {
        this.addDefaultParameters = true;
        this.collectedData = [];
        this.doAddProjectParameter = true;
        this.doReturnData = false;
        this.doSendPassword = true;
        this.doShowOutput = true;
        this.sdfCliIsInstalled = true; // Prevents error messages while Code is testing SDFCLI is installed.
        this.splitObjectString = true;
        this.xmlBuilder = new xml2js.Builder({ headless: true });
        this.getObjectFunc = (object, objects) => () => __awaiter(this, void 0, void 0, function* () {
            //Saved Searches should not be supported at this time.
            if (object.type === 'savedsearch')
                return;
            this.doAddProjectParameter = true;
            this.doReturnData = true;
            yield this.getConfig();
            if (this.sdfConfig) {
                if (objects.length > 0) {
                    const cleanedObjects = _.map(objects, obj => obj.split(':')[1]);
                    console.log('Synchronizing ' + object.type);
                    // const objectsChunked = _.chunk(cleanedObjects, 10);
                    // for (let i = 0; i < objectsChunked.length; i++) {
                    //   await this._importObjects(object.type, objectsChunked[i], object.destination);
                    // }
                    yield this._importObjects(object.type, cleanedObjects, object.destination);
                }
            }
        });
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
        }
        else {
            return 'SDF';
        }
    }
    /*********************/
    /** SDF CLI Commands */
    /*********************/
    addDependencies() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            this.doSendPassword = false;
            yield this.getConfig();
            const projectName = this.sdfConfig.projectName || 'PROJECT_NAME_MISSING';
            const defaultXml = `
    <manifest projecttype="ACCOUNTCUSTOMIZATION">
      <projectname>${projectName}</projectname>
      <frameworkversion>1.0</frameworkversion>
    </manifest>
    `;
            fs.writeFile(path.join(this.rootPath, 'manifest.xml'), defaultXml, function (err) {
                if (err)
                    throw err;
            });
            yield this.runCommand(cli_command_1.CLICommand.AddDependencies, '-all');
        });
    }
    createProject() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            this.doSendPassword = false;
            this.addDefaultParameters = false;
            const pathPrompt = `Please enter your the parent directory to create the Project in`;
            const outputPath = yield promptly.prompt(pathPrompt);
            if (outputPath) {
                const projectNamePrompt = `Please enter your project's name`;
                const projectName = yield promptly.prompt(projectNamePrompt);
                if (projectName) {
                    yield this.runCommand(cli_command_1.CLICommand.CreateProject, `-pd ${outputPath}`, `-pn ${projectName}`, '-t ACCOUNTCUSTOMIZATION');
                }
            }
        });
    }
    _generateTempDeployDirectory() {
        return __awaiter(this, void 0, void 0, function* () {
            const deployPath = path.join(this.rootPath, 'deploy.xml');
            const deployXmlExists = yield this.fileExists(deployPath);
            if (!deployXmlExists) {
                this.setDefaultDeployXml();
            }
            const deployXml = yield this.openFile(deployPath);
            const deployJs = yield this.parseXml(deployXml);
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
                    yield this.copyFile(fromPath, toPath);
                    console.log('wait');
                }
            }
            catch (e) {
                console.log(e);
            }
        });
    }
    deploy() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            yield this.getConfig();
            const useQuickDeploy = _.get(this.sdfConfig, 'useQuickDeploy', false);
            if (useQuickDeploy) {
                yield this._generateTempDeployDirectory();
                yield this.runCommand(cli_command_1.CLICommand.Deploy);
                yield rimraf(this.rootPath + '/var', (err) => {
                    console.error(err.message);
                });
            }
            else {
                yield this.runCommand(cli_command_1.CLICommand.Deploy);
            }
        });
    }
    importBundle() {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        // TODO?
        this.doAddProjectParameter = false;
        this.runCommand(cli_command_1.CLICommand.ImportBundle);
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
    _importFiles(files) {
        return __awaiter(this, void 0, void 0, function* () {
            const cleanedFiles = _.map(files, file => `"${file}"`);
            const fileString = cleanedFiles.join(' ');
            this.runCommand(cli_command_1.CLICommand.ImportFiles, `-paths ${fileString}`);
        });
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
    _importObjects(scriptType, scriptIds, destination) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.createPath(destination);
            const scriptIdString = scriptIds.join(' ');
            return this.runCommand(cli_command_1.CLICommand.ImportObjects, `-scriptid ${scriptIdString}`, `-type ${scriptType}`, `-destinationfolder ${destination}`);
        });
    }
    issueToken() {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        this.doAddProjectParameter = false;
        this.runCommand(cli_command_1.CLICommand.IssueToken);
    }
    listBundles() {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        this.doAddProjectParameter = false;
        this.runCommand(cli_command_1.CLICommand.ListBundles);
    }
    listFiles() {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        this.doAddProjectParameter = false;
        return this.runCommand(cli_command_1.CLICommand.ListFiles, '-folder /SuiteScripts');
    }
    listMissingDependencies() {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        this.doSendPassword = false;
        this.runCommand(cli_command_1.CLICommand.ListMissingDependencies);
    }
    listObjects(type_) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            this.doAddProjectParameter = false;
            this.doReturnData = true;
            yield this.getConfig();
            if (this.sdfConfig) {
                if (type_ === 'all') {
                    this.splitObjectString = false;
                    return this.runCommand(cli_command_1.CLICommand.ListObjects);
                }
                if (type_) {
                    if (!_.includes(custom_object_1.CustomObjectTypes, type_)) {
                        console.error(`Invalid custom object type: ${type_}`);
                        return this.exit();
                    }
                }
                else {
                    // this.currentObject = await vscode.window.showQuickPick(CustomObjects, {
                    //   ignoreFocusOut: true
                    // });
                    // type_ = this.currentObject.type;
                }
                if (type_) {
                    return this.runCommand(cli_command_1.CLICommand.ListObjects, `-type ${this.currentObject.type}`);
                }
            }
        });
    }
    preview() {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        this.runCommand(cli_command_1.CLICommand.Preview);
    }
    revokeToken() {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        this.doAddProjectParameter = false;
        this.runCommand(cli_command_1.CLICommand.RevokeToken);
    }
    saveToken(tokenId, tokenSecret) {
        if (!this.sdfCliIsInstalled) {
            console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
            return;
        }
        this.doAddProjectParameter = false;
        this.runCommand(cli_command_1.CLICommand.SaveToken, `-tokenid ${tokenId}`, `-tokensecret ${tokenSecret}`);
    }
    getFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getConfig();
            if (this.sdfConfig) {
                const files = yield this.listFiles();
                if (files) {
                    console.log('Synchronizing SuiteScript folder.');
                    yield this._importFiles(files);
                }
            }
            else {
                return;
            }
        });
    }
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
        this.runCommand(cli_command_1.CLICommand.Validate);
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
    removeFolders() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getConfig();
            if (this.sdfConfig) {
                console.log('Emptying: ' + this.rootPath + '/Objects/');
                yield rimraf(this.rootPath + '/Objects/*', (err) => {
                    console.error(err);
                });
                console.log('Emptying: ' + this.rootPath + '/FileCabinet/SuiteScripts/');
                yield rimraf(this.rootPath + '/FileCabinet/SuiteScripts/*', (err) => {
                    console.error(err);
                });
            }
        });
    }
    resetPassword() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            const _resetPassword = () => __awaiter(this, void 0, void 0, function* () {
                const prompt = `Please enter your password for your ${this.activeEnvironment.name} account.`;
                const password = yield promptly.password(prompt);
                this.password = password;
            });
            if (this.sdfConfig) {
                yield _resetPassword();
            }
            else {
                yield this.getConfig({ force: true });
                yield _resetPassword();
            }
        });
    }
    selectEnvironment() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            const _selectEnvironment = () => __awaiter(this, void 0, void 0, function* () {
                if (this.currentFunctionName === 'setEnvironment') {
                    return;
                }
                try {
                    const environments = this.sdfConfig.environments.reduce((acc, curr) => {
                        acc[curr.name] = curr;
                        return acc;
                    }, {});
                    const environmentNames = Object.keys(environments);
                    const activeEnvironments = _.filter(environments, (env, name) => env.active);
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
                    }
                    else {
                        const environmentName = yield promptly.choose(`Please type an environment name [${environmentNames.join(', ')}]:\n`, environmentNames);
                        if (environmentName) {
                            this.activeEnvironment = environments[environmentName];
                            if (this.activeEnvironment.account === '00000000') {
                                console.error('.sdfcli.json account number appears to be wrong. Are you still using the blank template?');
                                this.sdfConfig = undefined;
                                this.activeEnvironment = undefined;
                                // this.clearStatus();
                            }
                            else {
                                // this.statusBar.text = this.statusBarDefault;
                            }
                        }
                    }
                }
                catch (e) {
                    console.error('Unable to parse .sdfcli.json environments. Please check repo for .sdfcli.json formatting.');
                    // this.clearStatus();
                }
            });
            if (this.sdfConfig) {
                yield _selectEnvironment();
            }
            else {
                yield this.getConfig({ force: true });
            }
        });
    }
    setDefaultDeployXml() {
        const defaultXml = `<deploy></deploy>`;
        fs.writeFile(path.join(this.rootPath, 'deploy.xml'), defaultXml, function (err) {
            if (err)
                throw err;
        });
    }
    setEnvironment(env) {
        return __awaiter(this, void 0, void 0, function* () {
            this.currentFunctionName = 'setEnvironment';
            yield this.getConfig();
            const environments = this.sdfConfig.environments.reduce((acc, curr) => {
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
                const noActiveEnvironments = _.map(sdfEnvironments, (environment) => {
                    delete environment.active;
                    return environment;
                });
                const withActiveEnvironment = _.map(noActiveEnvironments, (environment) => {
                    if (environment.name === env) {
                        environment.active = true;
                    }
                    return environment;
                });
                this.sdfConfig.environments = withActiveEnvironment;
                fs.writeFile(path.join(this.rootPath, '.sdfcli.json'), JSON.stringify(this.sdfConfig, null, 4), function (err) {
                    if (err)
                        throw err;
                });
            }
            catch (e) {
                console.log(e);
            }
            this.cleanup();
        });
    }
    sync() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            try {
                yield this.getConfig();
            }
            catch (e) {
                console.error('Unable to fetch config. Aborting.');
                this.exit(1);
            }
            try {
                yield this.removeFolders();
            }
            catch (e) {
                console.error('Unable to clear folders. Aborting.');
                this.exit(1);
            }
            try {
                if (this.sdfConfig) {
                    const allCustomObjects = yield this.listObjects('all');
                    const objectGroups = _.groupBy(allCustomObjects, objectString => objectString.split(':')[0]);
                    const objectCommands = _.map(objectGroups, (objects, type_) => {
                        const obj = CustomObjectMap[type_];
                        return this.getObjectFunc(obj, objects); // Returns a lazy closure
                    });
                    yield this.getFiles();
                    yield Bluebird.map(objectCommands, func => func(), { concurrency: 10 });
                    console.log('Synchronization complete!');
                    this.exit();
                }
            }
            catch (e) {
            }
            finally {
                this.cleanup();
            }
        });
    }
    /*********************/
    /** VS Code Helpers **/
    /*********************/
    checkSdfCliIsInstalled() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Don't like this. There must be a better way.
                const thread = yield spawn_rx_1.spawn('sdfcli').toPromise();
                this.sdfCliIsInstalled = true;
            }
            catch (e) {
                this.sdfCliIsInstalled = false;
                if (e.code === 'ENOENT') {
                    console.error("'sdfcli' not found in path! Check repo for install directions.");
                }
                else {
                    throw e;
                }
            }
        });
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
    getConfig({ force = false } = {}) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.sdfCliIsInstalled) {
                console.error("'sdfcli' not found in path. Please restart VS Code if you installed it.");
                return;
            }
            if (force || !this.sdfConfig) {
                this.rootPath = process.cwd();
                const sdfTokenPath = path.join(this.rootPath, '.clicache');
                const sdfCacheExists = yield this.fileExists(sdfTokenPath);
                if (sdfCacheExists) {
                    this.hasSdfCache = true;
                }
                const sdfPath = path.join(this.rootPath, '.sdfcli.json');
                const sdfPathExists = yield this.fileExists(sdfPath);
                if (sdfPathExists) {
                    const buffer = yield this.openFile(path.join(this.rootPath, '.sdfcli.json'));
                    const jsonString = buffer.toString();
                    try {
                        this.sdfConfig = JSON.parse(jsonString);
                        yield this.selectEnvironment();
                    }
                    catch (e) {
                        console.error(`Unable to parse .sdfcli.json file found at project root: ${this.rootPath}`);
                    }
                }
                else {
                    fs.writeFileSync(path.join(this.rootPath, '.sdfcli.json'), sdf_cli_json_1.SdfCliJson);
                    console.error(`No .sdfcli.json file found at project root: ${this.rootPath}. Generated a blank .sdfcli.json template.`);
                    this.exit(1);
                }
            }
            else if (!this.activeEnvironment) {
                yield this.selectEnvironment();
            }
        });
    }
    handlePassword(line, command, stdinSubject) {
        if (line.startsWith('Enter password:')) {
            line = line.substring(15);
        }
        if (line.includes('You have entered an invalid email address or password. Please try again.')) {
            this.password = undefined;
            console.error('Invalid email or password. Be careful! Too many attempts will lock you out!');
        }
        return line;
    }
    handleStdIn(line, command, stdinSubject) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (true) {
                case line.includes('Using user credentials.') && this.doSendPassword:
                    if (!this.password) {
                        yield this.resetPassword();
                    }
                    stdinSubject.next(`${this.password}\n`);
                    break;
                case line.includes('WARNING! You are deploying to a Production account, enter YES to continue'):
                    const prompt = "Please type 'Deploy' to deploy to production.";
                    const answer = yield promptly.prompt(prompt);
                    if (answer === 'Deploy') {
                        stdinSubject.next('YES\n');
                    }
                    else {
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
        });
    }
    handleStdOut(line, command) {
        return __awaiter(this, void 0, void 0, function* () {
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
        });
    }
    mapCommandOutput(command, line) {
        switch (command) {
            case cli_command_1.CLICommand.ListObjects:
                if (this.splitObjectString) {
                    return line.includes(':') ? line.split(':')[1] : line;
                }
                else {
                    return line;
                }
            default:
                return line;
        }
    }
    runCommand(command, ...args) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getConfig();
            if (this.sdfConfig &&
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
                let commandArray = [command];
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
                const stdinSubject = new Subject_1.Subject();
                this.sdfcli = spawn_rx_1.spawn('sdfcli', commandArray, {
                    cwd: workPath,
                    stdin: stdinSubject,
                    windowsVerbatimArguments: true
                });
                this.showStatus();
                let streamWrapper = Observable_1.Observable.create(observer => {
                    let acc = '';
                    return this.sdfcli.subscribe(value => {
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
                    }, error => observer.error(error), () => observer.complete());
                });
                const collectedData = yield streamWrapper
                    .map(line => this.handlePassword(line, command, stdinSubject))
                    .do(line => (this.doShowOutput ? console.log(`${line}`) : null))
                    .do(line => this.handleStdIn(line, command, stdinSubject))
                    .do(line => this.handleStdOut(line, command))
                    .filter(line => !(!line ||
                    line.startsWith('[INFO]') ||
                    line.startsWith('SuiteCloud Development Framework CLI') ||
                    line.startsWith('Done.') ||
                    line.startsWith('Using ')))
                    .map(line => this.mapCommandOutput(command, line))
                    .reduce((acc, curr) => acc.concat([curr]), [])
                    .toPromise()
                    .catch(err => this.cleanup());
                this.cleanup();
                return collectedData;
            }
        });
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
    copyFile(relativeFrom, relativeTo) {
        return __awaiter(this, void 0, void 0, function* () {
            const toDir = relativeTo
                .split('/')
                .slice(0, -1)
                .join('/');
            this.createPath(toDir);
            const from = path.join(this.rootPath, relativeFrom);
            const to = path.join(this.rootPath, relativeTo);
            return fs.copyFile(from, to);
        });
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
            }
            catch (err) {
                if (err.code !== 'EEXIST') {
                    throw err;
                }
            }
            return curDir;
        }, initDir);
    }
    fileExists(path) {
        return new Promise((resolve, reject) => {
            try {
                fs.exists(path, exists => resolve(exists));
            }
            catch (e) {
                reject(e);
            }
        });
    }
    openFile(path) {
        return new Promise((resolve, reject) => {
            fs.readFile(path, (err, data) => {
                if (err) {
                    reject(err);
                }
                resolve(data);
            });
        });
    }
    ls(path) {
        return new Promise((resolve, reject) => {
            fs.readdir(path, (err, items) => {
                if (err) {
                    reject(err);
                }
                resolve(items);
            });
        });
    }
    parseXml(xml) {
        return new Promise((resolve, reject) => {
            xml2js.parseString(xml, function (err, result) {
                if (err) {
                    reject(err);
                }
                resolve(result);
            });
        });
    }
    getXMLFileList(dirList, root) {
        return __awaiter(this, void 0, void 0, function* () {
            const fileList = [];
            const traverseFolders = (folders, root) => __awaiter(this, void 0, void 0, function* () {
                if (folders.length > 0) {
                    for (const folder of folders) {
                        const rawFileList = yield this.ls(path.join(root, folder));
                        const dirList = [];
                        for (const fileName of rawFileList) {
                            const lstat = fs.lstatSync(path.join(root, folder, fileName));
                            if (lstat.isDirectory()) {
                                dirList.push(fileName);
                            }
                            else {
                                if (fileName.slice(fileName.length - 4) === '.xml') {
                                    fileList.push({
                                        path: path.join(root, folder, fileName),
                                        scriptid: fileName
                                    });
                                }
                            }
                        }
                        yield traverseFolders(dirList, path.join(root, folder));
                    }
                }
                else {
                    return folders;
                }
            });
            try {
                yield traverseFolders(dirList, root);
                return fileList;
            }
            catch (err) {
                console.error('Unable to get file list: ', err.message);
            }
        });
    }
    exit(code = 0) {
        process.exit(code);
    }
}
exports.NetSuiteSDF = NetSuiteSDF;
//# sourceMappingURL=netsuite-sdf.js.map