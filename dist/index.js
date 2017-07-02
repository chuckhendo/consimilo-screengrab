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
if (!process.versions.electron) {
    process.exit(1);
}
const electron_1 = require("electron");
const path = require("path");
const events_1 = require("events");
const uuid = require("uuid");
const sharp = require("sharp");
const FrameManager = require("./frame-manager");
class ScreenshotQueue extends events_1.EventEmitter {
    constructor({ threads, baseFolder }) {
        super();
        this.queue = [];
        this.running = false;
        this.workers = [];
        this.threads = threads || 1;
        this.baseFolder = baseFolder;
        for (let i = 0; i < this.threads; i++) {
            const worker = new ScreenshotWorker();
            this.workers.push(worker);
            worker.on("screenshot_taken", (screenshot) => {
                this.emit("screenshot_taken", screenshot);
            });
        }
    }
    add(ssConfig) {
        this.queue = this.queue.concat(ssConfig);
    }
    start() {
        this.running = true;
        this.workers.forEach((worker) => {
            worker.start();
            this.processQueueItem(worker);
        });
    }
    stop() {
        this.running = false;
    }
    processQueueItem(worker) {
        return __awaiter(this, void 0, void 0, function* () {
            const queueItem = this.queue.shift();
            if (queueItem) {
                yield worker.takeScreenshotsForUrl(this.baseFolder, queueItem);
                this.processQueueItem(worker);
            }
            else {
                worker.stop();
            }
        });
    }
}
exports.ScreenshotQueue = ScreenshotQueue;
class ScreenshotWorker extends events_1.EventEmitter {
    constructor() {
        super();
    }
    start() {
        if (!this.win) {
            this.win = new electron_1.remote.BrowserWindow({
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
    takeScreenshotsForUrl(baseFolder, ssConfig) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.win)
                return;
            yield this.loadURL(ssConfig.url);
            for (var i = 0; i < ssConfig.variations.length; i++) {
                const screenshot = yield this.takeScreenshot(baseFolder, ssConfig.variations[i]);
                this.emit("screenshot_taken", screenshot);
            }
        });
    }
    takeScreenshot(baseFolder, variationConfig) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.win)
                return;
            this.win.setSize(variationConfig.width, 200, false);
            this.win.setSize(variationConfig.width, yield this.getContentHeight(), false);
            const filename = path.join(baseFolder, `${uuid.v4()}.webp`);
            yield this.capturePage(filename);
            return filename;
        });
    }
    stop() {
        if (this.win) {
            this.win.close();
            this.win = undefined;
        }
    }
    capturePage(filename) {
        return new Promise((resolve, reject) => {
            if (!this.win)
                return reject();
            this.frameManager.requestFrame(() => {
                if (!this.win)
                    return reject();
                this.win.webContents.capturePage((image) => __awaiter(this, void 0, void 0, function* () {
                    yield sharp(image.toPNG()).webp({ lossless: true }).toFile(filename);
                    resolve(filename);
                }));
            });
        });
    }
    loadURL(url) {
        return new Promise((resolve, reject) => {
            if (!this.win) {
                return reject();
            }
            const { webContents } = this.win;
            webContents.on("did-finish-load", () => {
                webContents.removeAllListeners("did-finish-load");
                resolve();
            });
            this.win.loadURL(url);
        });
    }
    runJS(js) {
        if (!this.win)
            return;
        return this.win.webContents.executeJavaScript(js);
    }
    getContentHeight() {
        return this.runJS("document.documentElement.scrollHeight");
    }
}
