const puppeteer = require("puppeteer");
const fs = require("fs");

class Timer {
  constructor() {
    this.metrics = {};
  }

  start(label) {
    this.metrics[label] = {
      start: process.hrtime(),
      end: null,
      duration: null,
    };
  }

  end(label) {
    if (!this.metrics[label]) {
      throw new Error(`Timer label "${label}" not found`);
    }

    const diff = process.hrtime(this.metrics[label].start);
    this.metrics[label].end = new Date();
    this.metrics[label].duration =
      (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2) + "ms";
    return this.metrics[label].duration;
  }

  getMetrics() {
    return this.metrics;
  }

  logMetrics() {
    console.log("\n=== Performance Metrics ===");
    for (const [label, metric] of Object.entries(this.metrics)) {
      console.log(`${label}: ${metric.duration}`);
    }
    console.log("=========================\n");
  }
}
const timer = new Timer();

const CONFIG = {
  BASE_URL: "https://clients.12livery.ma",
  LOGIN: {
    URL: "/login",
    SELECTORS: {
      USERNAME: "#exampleInputUsername1",
      PASSWORD: "#exampleInputPassword1",
      SUBMIT: ".login100-form-btn",
    },
  },
  RETURN_NOTES: {
    URL: "/return-note",
    SELECTORS: {
      ROWS: "table > tbody > tr",
      DROPDOWN: "select.custom-select",
      DETAILS_PAGE_INDICATOR: "#rn_added_parcels_table",
      TABLE_LOADED: "table.dataTable",
    },
  },
};
(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox"],
    });

    const page = await browser.newPage();
    // await page.goto("https://example.com");
    await login();

    // Create screenshots directory if not exists
    if (!fs.existsSync("screenshots")) {
      fs.mkdirSync("screenshots");
    }

    await page.screenshot({
      path: "screenshots/example.png",
      fullPage: true,
    });

    console.log("Screenshot saved to screenshots/example.png");
    await browser.close();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();

async function login(page) {
  timer.start("login");
  try {
    console.log("Navigating to login page...");
    timer.start("login_navigation");
    await page.goto(`${CONFIG.BASE_URL}${CONFIG.LOGIN.URL}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    timer.end("login_navigation");

    console.log("Entering credentials...");
    timer.start("login_credentials_entry");
    await page.waitForSelector(CONFIG.LOGIN.SELECTORS.USERNAME, {
      visible: true,
    });
    await page.type(
      CONFIG.LOGIN.SELECTORS.USERNAME,
      process.env.LOGIN_EMAIL || "sellingkhalid@gmail.com",
      { delay: 30 }
    );

    await page.waitForSelector(CONFIG.LOGIN.SELECTORS.PASSWORD, {
      visible: true,
    });
    await page.type(
      CONFIG.LOGIN.SELECTORS.PASSWORD,
      process.env.LOGIN_PASSWORD || "moiy@1421",
      { delay: 30 }
    );

    timer.end("login_credentials_entry");
    console.log("Submitting login form...");
    timer.start("login_submission");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      page.click(CONFIG.LOGIN.SELECTORS.SUBMIT),
    ]);

    timer.end("login_submission");
    console.log("✔ Login successful");
    timer.end("login");

    return true;
  } catch (error) {
    timer.end("login");
    console.error("Login failed:", error);
    await page.screenshot({ path: "login-error.png" });
    throw error;
  }
}
