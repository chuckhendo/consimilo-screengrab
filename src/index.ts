if (!process.versions.electron) {
  process.exit(1);
}

import {remote} from "electron";
import * as fs from "fs";
import * as path from "path";
import {EventEmitter} from "events";
import * as uuid from "uuid";
import * as sharp from "sharp";

import * as FrameManager from "./frame-manager";

interface IScreenshotQueueOptions {
    threads?: number,
    baseFolder: string    
}

interface ISharedConfig {
    width?: number,
    element?: string,
    hideElements?: string[]
}

interface IScreenshotConfig extends ISharedConfig {
    url: string,
    variations: IScreenshotConfigVariation[]
}

interface IScreenshotConfigVariation extends ISharedConfig {

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
            const worker = new ScreenshotWorker()
            this.workers.push(worker);

            worker.on("screenshot_taken", (screenshot) => {
                this.emit("screenshot_taken", screenshot);
            });
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

        this.emit("started");
    }

    public stop() {
        this.running = false;
        this.workers.forEach((worker) => worker.stop());

        this.emit("finished");
    }

    private async processQueueItem(worker: ScreenshotWorker) {
        const queueItem = this.queue.shift();

        if(queueItem) {
            await worker.takeScreenshotsForUrl(this.baseFolder, queueItem);
            this.processQueueItem(worker);
        } else {
            worker.stop();
            if(this.workers.filter((worker) => worker.running).length === 0) {
                this.stop();
            }
        }
    }
}

class ScreenshotWorker extends EventEmitter {
    public running = false;
    private win: Electron.BrowserWindow | undefined;
    private frameManager: any;
    
    constructor() {
        super();
    }

    public start() {
        if(!this.win) {
            this.win = new remote.BrowserWindow({
                show: false,
                width: 1200,
                frame: false,
                webPreferences: {
                    nodeIntegration: false,
                    offscreen: true
                }
            });

            this.frameManager = FrameManager(this.win);
            this.running = true;
        }
    }

    public stop() {
        if(this.win) {
            this.win.close();
            this.win = undefined;
            this.running = false;
        }
    }

    public async takeScreenshotsForUrl(baseFolder: string, ssConfig: IScreenshotConfig) {
        if(!this.win) return;
        await this.loadURL(ssConfig.url);
        this.runJS(`
            function getElementRect(element) {
                const rect = document.querySelector(element).getBoundingClientRect();
                return JSON.stringify({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
            }

            function insertCSS(css) {
                const prevStyleEl = document.querySelectorAll("[data-tag-source='huger']");
                if(prevStyleEl.length > 0) {
                    prevStyleEl.forEach((styleEl) => {
                        styleEl.parentNode.removeChild(styleEl);
                    });
                }
                const styleEl = document.createElement("style");
                styleEl.setAttribute("data-tag-source", "huger");
                styleEl.innerText = css;
                document.head.appendChild(styleEl);
            }
        `);
        for(var i = 0; i < ssConfig.variations.length; i++) {
            if(!this.win) return;
            const screenshot = await this.takeScreenshot(baseFolder, { ...ssConfig, ...ssConfig.variations[i] });
            this.emit("screenshot_taken", screenshot);            
        }        
    }

    private async takeScreenshot(baseFolder: string, {width, element, hideElements}: IScreenshotConfig) {
        if(!this.win) return;
        if(width) {
            this.win.setSize(width, 200, false);
            this.win.setSize(width, await this.getContentHeight(), false);
        }
        const filename = path.join(baseFolder, `${uuid.v4()}.webp`);

        if(hideElements) {
            const styles = hideElements.length > 0 ? `${hideElements.join(", ")} { display: none; }` : "";
            this.runJS(`insertCSS("${styles}")`);
        }

        // code for element only screenshots
        if(element) {
            const elementRect = await this.getElementRect(element);
            await this.capturePage(filename, elementRect);
        } else {
            await this.capturePage(filename);
        }

        return filename;
    }

    private capturePage(filename: string, rect?: Electron.Rectangle) {
        return new Promise((resolve, reject) => {
            if(!this.win) return reject();
            
            this.frameManager.requestFrame(() => {
                if(!this.win) return reject();

                if(rect) {
                    this.win.webContents.capturePage(rect, async (image) => { 
                        await sharp(image.toPNG()).webp({lossless: true}).toFile(filename);
                        resolve(filename);
                    });
                } else {
                    this.win.webContents.capturePage(async (image) => { 
                        await sharp(image.toPNG()).webp({lossless: true}).toFile(filename);
                        resolve(filename);
                    });
                }
            }, 3000);
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
        if(!this.win) return;
        return this.win.webContents.executeJavaScript(js);
    }

    private getContentHeight(): Promise<number> {
        return this.runJS("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)") as Promise<number>;
    }

    private async getElementRect(element: string): Promise<Electron.Rectangle> {
        const rectString: string = await this.runJS(`getElementRect("${element}");`);

        return JSON.parse(rectString) as Electron.Rectangle;
    }
}
