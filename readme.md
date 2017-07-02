# consimilo-screengrab

## Usage

- Install from npm with `npm install consimilo-screengrab`
- Create a ScreenshotQueue
```js
import { ScreenshotQueue } from "consimilo-screengrab";

const ssQueue = new ScreenshotQueue({
    baseFolder: "~/Documents",
    threads: 1    
});
```
- Add ScreenshotConfigs
```js
ssQueue.add([
    {
        url: "http://github.com",
        width: "1200"
    },
    {
        url: "http://google.com",
        width: "900"
    }
]);
```
- Add event listeners
```js
ssQueue.on("screenshot_taken", function(screenshotPath) { });
ssQueue.on("start", function() { });
ssQueue.on("finished", function(screenshotPath) { });
```
- Start the process
```js
ssQueue.start();
```

## Configuration
### ScreenshotQueue

ScreenshotQueue is a constructor that can take the following options
- `baseFolder`: Required, sets the folder that images will be stored in
- `threads`: Default: `1`, sets the number of threads that run simultaneously

### ScreenshotConfig

The `.add` method can take a single or multiple ScreenshotConfigs. Available options:
- `url`: Required, sets the URL that is scanned
- `width`: Optional, sets the width of the window when screenshot is grabbed
- `element`: Optional, instead of taking a screenshot of the entire page, take a screenshot of a single element
- `hideElements`: Optional, array of strings that can be passed to document.querySelectorAll()
- `variations`: Optional, variations are a way to take multiple screenshots of the same url without reloading the page. It can take all of the above options, except url

