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
        this.emit("started");
    }
    stop() {
        this.running = false;
        this.workers.forEach((worker) => worker.stop());
        this.emit("finished");
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
                if (this.workers.filter((worker) => worker.running).length === 0) {
                    this.stop();
                }
            }
        });
    }
}
exports.ScreenshotQueue = ScreenshotQueue;
class ScreenshotWorker extends events_1.EventEmitter {
    constructor() {
        super();
        this.running = false;
    }
    start() {
        if (!this.win) {
            this.win = new electron_1.remote.BrowserWindow({
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
    stop() {
        if (this.win) {
            this.win.close();
            this.win = undefined;
            this.running = false;
        }
    }
    takeScreenshotsForUrl(baseFolder, ssConfig) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.win)
                return;
            yield this.loadURL(ssConfig.url);
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

            function replaceContent(element, text) {
                Array.from(document.querySelectorAll(element)).forEach((el) => {
                    el.innerText = text;
                });
            }
        `);
            for (var i = 0; i < ssConfig.variations.length; i++) {
                if (!this.win)
                    return;
                const screenshot = yield this.takeScreenshot(baseFolder, Object.assign({}, ssConfig, ssConfig.variations[i]));
                this.emit("screenshot_taken", screenshot);
            }
        });
    }
    takeScreenshot(baseFolder, { width, element, hideElements, replaceContent }) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.win)
                return;
            if (width) {
                this.win.setSize(width, 200, false);
                this.win.setSize(width, yield this.getContentHeight(), false);
            }
            const filename = path.join(baseFolder, `${uuid.v4()}.webp`);
            if (hideElements) {
                const styles = hideElements.length > 0 ? `${hideElements.join(", ")} { display: none; }` : "";
                this.runJS(`insertCSS("${styles}")`);
            }
            if (replaceContent) {
                replaceContent.forEach((item) => {
                    this.runJS(`replaceContent("${item.selector}", "${item.text}");`);
                });
            }
            // code for element only screenshots
            if (element) {
                const elementRect = yield this.getElementRect(element);
                yield this.capturePage(filename, elementRect);
            }
            else {
                yield this.capturePage(filename);
            }
            return filename;
        });
    }
    capturePage(filename, rect) {
        return new Promise((resolve, reject) => {
            if (!this.win)
                return reject();
            this.frameManager.requestFrame(() => {
                if (!this.win)
                    return reject();
                if (rect) {
                    this.win.webContents.capturePage(rect, (image) => __awaiter(this, void 0, void 0, function* () {
                        yield sharp(image.toPNG()).webp({ lossless: true }).toFile(filename);
                        resolve(filename);
                    }));
                }
                else {
                    this.win.webContents.capturePage((image) => __awaiter(this, void 0, void 0, function* () {
                        yield sharp(image.toPNG()).webp({ lossless: true }).toFile(filename);
                        resolve(filename);
                    }));
                }
            }, 3000);
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
        return this.runJS("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)");
    }
    getElementRect(element) {
        return __awaiter(this, void 0, void 0, function* () {
            const rectString = yield this.runJS(`getElementRect("${element}");`);
            return JSON.parse(rectString);
        });
    }
}
