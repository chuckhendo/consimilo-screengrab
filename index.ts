if (!process.versions.electron) {
  process.exit(1);
}

import {remote} from "electron";
import * as fs from "fs";
import * as path from "path";
import {EventEmitter} from "events";
import * as uuidv4 from "uuid/v4";
import * as sharp from "sharp";

import * as FrameManager from "./frame-manager";

interface IScreenshotQueueOptions {
    threads?: number,
    baseFolder: string    
}

interface IScreenshotConfig {
    url: string,
    width: number
}

export class ScreenshotQueue extends EventEmitter {
    public queue: IScreenshotConfig[] = [];
    public running = false;

    private threads: number;
    private workers: ScreenshotWorker[] = [];
    private baseFolder: string;
    
    constructor({threads, baseFolder}: IScreenshotQueueOptions) {
        super();
        this.threads = threads || 1;
        this.baseFolder = baseFolder;

        for(let i = 0; i < this.threads; i++) {
            this.workers.push(new ScreenshotWorker());
        }
    }

    public add(ssConfig: IScreenshotConfig | IScreenshotConfig[]) {
        this.queue = this.queue.concat(ssConfig);
    }

    public start() {
        this.running = true;
        this.workers.forEach((worker) => {
            worker.start();
            this.processQueueItem(worker);
        });
    }

    public stop() {
        this.running = false;
    }

    private async processQueueItem(worker: ScreenshotWorker) {
        const queueItem = this.queue.shift();

        if(queueItem) {
            console.log(await worker.takeScreenshot(this.baseFolder, queueItem));
            this.processQueueItem(worker);
        } else {
            worker.stop();
        }
    }
}

class ScreenshotWorker extends EventEmitter {
    private win: Electron.BrowserWindow | undefined;
    
    constructor() {
        super();
    }

    public start() {
        if(!this.win) {
            this.win = new remote.BrowserWindow({
                show: false,
                width: 1200,
                webPreferences: {
                    nodeIntegration: false,
                    offscreen: true
                }
            });

            this.frameManager = FrameManager(this.win);
        }
    }

    public async takeScreenshot(baseFolder: string, ssConfig: IScreenshotConfig) {
        if(!this.win) {
            return;
        }
        this.win.setSize(ssConfig.width, 200, false);
        await this.loadURL(ssConfig.url);
        this.win.setSize(ssConfig.width, await this.getContentHeight(), false);
        const filename = path.join(baseFolder, `${uuidv4()}.webp`);
        await this.capturePage(filename);
        return filename;
    }
    
    public stop() {
        if(this.win) {
            this.win.close();
            this.win = undefined;
        }
    }

    private capturePage(filename: string) {
        return new Promise((resolve, reject) => {
            if(!this.win) {
                return reject();
            }
            this.frameManager.requestFrame(() => {
                this.win.webContents.capturePage((image) => { 
                    sharp(image.toPNG()).webp({lossles: true}).toFile(filename);
                    resolve(filename);
                });
            });
        });
    }

    private loadURL(url: string) {
        return new Promise((resolve, reject) => {
            if(!this.win) {
                return reject();
            }
            const {webContents} = this.win;
            webContents.on("did-finish-load", () => {
                webContents.removeAllListeners("did-finish-load");
                resolve();
            });

            this.win.loadURL(url);
        });
    }

    private runJS(js: string) {
        return new Promise((resolve, reject) => {
            this.win.webContents.executeJavaScript(js, (result) => {
                resolve(result);
            });
        });
    }

    private getContentHeight(): Promise<number> {
        return this.runJS("document.documentElement.scrollHeight") as Promise<number>;
    }
}
