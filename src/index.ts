import * as fs from "fs";
import * as path from "path";
import puppeteer from "puppeteer";
import { PuppeteerScreenRecorder } from "puppeteer-screen-recorder";
import type { eventWithTime } from "rrweb/typings/types";
import type { RRwebPlayerOptions } from "rrweb-player";

const rrwebScriptPath = path.resolve(
  require.resolve("rrweb-player"),
  "../../dist/index.js"
);
const rrwebStylePath = path.resolve(rrwebScriptPath, "../style.css");
const rrwebRaw = fs.readFileSync(rrwebScriptPath, "utf-8");
const rrwebStyle = fs.readFileSync(rrwebStylePath, "utf-8");

function getHtml(
  events: Array<eventWithTime>,
  config?: Omit<RRwebPlayerOptions["props"], "events">
): string {
  return `
<html>
  <head>
  <style>${rrwebStyle}</style>
  </head>
  <body>
    <script>
      ${rrwebRaw};
      /*<!--*/
      const events = ${JSON.stringify(events).replace(
        /<\/script>/g,
        "<\\/script>"
      )};
      /*-->*/
      const userConfig = ${config ? JSON.stringify(config) : {}};
      window.replayer = new rrwebPlayer({
        target: document.body,
        props: {
          events,
          showController: false,
          speed: 1,
          ...userConfig
        },
      });
      window.onReplayStart();
      window.replayer.play();
      window.replayer.addEventListener('finish', () => window.onReplayFinish());
    </script>
  </body>
</html>
`;
}

type RRvideoConfig = {
  fps: number;
  headless: boolean;
  input: string;
  cb: (file: string, error: null | Error) => void;
  output: string;
  rrwebPlayer: Omit<RRwebPlayerOptions["props"], "events">;
};

const defaultConfig: RRvideoConfig = {
  fps: 8,
  headless: true,
  input: "",
  cb: () => {},
  output: "rrvideo-output.mp4",
  rrwebPlayer: {},
};

class RRvideo {
  private browser!: puppeteer.Browser;
  private page!: puppeteer.Page;
  private config: RRvideoConfig;

  constructor(config?: Partial<RRvideoConfig> & { input: string }) {
    this.config = {
      fps: config?.fps || defaultConfig.fps,
      headless: config?.headless || defaultConfig.headless,
      input: config?.input || defaultConfig.input,
      cb: config?.cb || defaultConfig.cb,
      output: config?.output || defaultConfig.output,
      rrwebPlayer: config?.rrwebPlayer || defaultConfig.rrwebPlayer,
    };
  }

  public async init() {
    try {
      this.browser = await puppeteer.launch({
        headless: this.config.headless,
        args: [
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--shm-size=2gb",
        ],
        /* DISABLE SANDBOX:
        CHANGE USER DOESN'T WORKS 'Failed to move to new namespace:' */
      });

      const pages = await this.browser.pages();
      this.page = pages[0];

      /* DISABLE NAVIGATION TIME OUT      
      await this.page.setDefaultNavigationTimeout(0); */

      await this.page.goto("about:blank", { timeout: 0 });
      await this.page.setViewport({
        width: 1080,
        height: 600,
        deviceScaleFactor: 1,
      });
      const recorder = new PuppeteerScreenRecorder(this.page);

      await this.page.exposeFunction("onReplayStart", async () => {
        await recorder.start(this.config.output);
      });

      await this.page.exposeFunction("onReplayFinish", async () => {
        await recorder.stop();
        await this.browser.close();
      });

      const eventsPath = path.isAbsolute(this.config.input)
        ? this.config.input
        : path.resolve(process.cwd(), this.config.input);
      const events = JSON.parse(fs.readFileSync(eventsPath, "utf-8"));

      await this.page.setContent(getHtml(events, this.config.rrwebPlayer));
    } catch (error: any) {
      this.config.cb("Something went wrong while converting video", error);
    }
  }
}

export function transformToVideo(
  config: Partial<RRvideoConfig> & { input: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const rrvideo = new RRvideo({
      ...config,
      cb(file, error) {
        if (error) {
          return reject(error);
        }
        resolve(file);
      },
    });
    rrvideo.init();
  });
}
