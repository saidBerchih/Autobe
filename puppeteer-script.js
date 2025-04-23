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
    // await login();
    await page.goto(`${CONFIG.BASE_URL}${CONFIG.LOGIN.URL}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
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
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      page.click(CONFIG.LOGIN.SELECTORS.SUBMIT),
    ]);

    const returnNotes = await getReturnNotes(page);
    // Create screenshots directory if not exists
    if (!fs.existsSync("screenshots")) {
      fs.mkdirSync("screenshots");
    }

    if (!fs.existsSync("data")) {
      fs.mkdirSync("data");
    }
    fs.writeFileSync(
      "data/return-notes.json",
      JSON.stringify(returnNotes, null, 2)
    );
    console.log(
      `Successfully processed ${returnNotes.length} return notes. Data saved to return-notes.json`
    );
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
async function processReturnNote(page, noteId) {
  const noteUrl = `https://clients.12livery.ma/return-note?action=show&rn-ref=${noteId}`;

  try {
    await page.goto(noteUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await page.waitForSelector(
      CONFIG.RETURN_NOTES.SELECTORS.DETAILS_PAGE_INDICATOR,
      {
        visible: true,
        timeout: 15000,
      }
    );
    await page.waitForSelector(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, {
      visible: true,
    });
    await page.select(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, "50");

    const parcels = await page.$$eval(
      CONFIG.RETURN_NOTES.SELECTORS.ROWS,
      (rows) =>
        rows.map((row) => {
          const cells = row.querySelectorAll("td");
          return {
            parcelNumber: cells[0]?.textContent.trim(),
            date: cells[2]?.textContent.trim(),
            city: cells[3]?.textContent.trim(),
            status: cells[8]?.textContent.trim(),
          };
        })
    );

    return {
      returnNoteId: noteId,
      url: noteUrl,
      parcels: parcels,
      processedAt: new Date().toISOString(),
      metrics: {
        parcelCount: parcels.length,
        processingDate: new Date().toISOString(),
      },
    };
  } catch (error) {
    throw error;
  }
}

async function getReturnNotes(page) {
  const results = [];

  try {
    await page.goto(`${CONFIG.BASE_URL}${CONFIG.RETURN_NOTES.URL}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await page.waitForSelector(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, {
      visible: true,
    });
    await page.select(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, "50");

    const noteIds = await page.$$eval(
      CONFIG.RETURN_NOTES.SELECTORS.ROWS,
      (rows) => rows.map((row) => row.id).filter(Boolean)
    );

    for (const noteId of noteIds) {
      try {
        const noteDetails = await processReturnNote(page, noteId);
        results.push(noteDetails);
      } catch (error) {
        console.error(`Error processing return note ${noteId}:`, error);
        continue;
      }
    }

    return results;
  } catch (error) {
    await page.screenshot({ path: "return-notes-error.png" });
    throw error;
  }
}
