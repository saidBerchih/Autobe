// scraper.js
import puppeteer from "puppeteer";
import ReturnNotesDatabase from "./database.js";

const isCI = process.env.CI === "true";

const browserConfig = {
  headless: isCI ? true : false,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    ...(isCI ? ["--disable-dev-shm-usage", "--single-process"] : []),
  ],
};

const dbPath = isCI
  ? "/github/workspace/.github/private/return_notes.db"
  : "./return_notes.db";

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "Reason:", reason);
  if (isCI) process.exit(1);
});

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

async function getReturnNotes(page) {
  timer.start("getReturnNotes");
  const results = [];

  try {
    console.log("Navigating to return notes page...");
    timer.start("return_notes_navigation");
    await page.goto(`${CONFIG.BASE_URL}${CONFIG.RETURN_NOTES.URL}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    timer.end("return_notes_navigation");

    console.log("Setting page size to 50...");
    timer.start("table_configuration");
    await page.waitForSelector(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, {
      visible: true,
    });
    await page.select(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, "50");
    timer.end("table_configuration");

    console.log("Extracting return note IDs...");
    timer.start("note_id_extraction");
    const noteIds = await page.$$eval(
      CONFIG.RETURN_NOTES.SELECTORS.ROWS,
      (rows) => rows.map((row) => row.id).filter(Boolean)
    );
    timer.end("note_id_extraction");

    console.log(`Found ${noteIds.length} return notes to process...`);
    timer.start("notes_processing");

    for (const noteId of noteIds) {
      try {
        console.log(`Processing return note ${noteId}...`);
        const noteDetails = await processReturnNote(page, noteId);
        results.push(noteDetails);
      } catch (error) {
        console.error(`Error processing return note ${noteId}:`, error);
        continue;
      }
    }

    timer.end("notes_processing");
    timer.end("getReturnNotes");
    return results;
  } catch (error) {
    timer.end("getReturnNotes");
    console.error("Error in getReturnNotes:", error);
    await page.screenshot({ path: "return-notes-error.png" });
    throw error;
  }
}

async function processReturnNote(page, noteId) {
  timer.start(`processReturnNote ${noteId}`);
  const noteUrl = `https://clients.12livery.ma/return-note?action=show&rn-ref=${noteId}`;

  try {
    timer.start(`navigation ${noteId}`);
    await page.goto(noteUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    timer.end(`navigation ${noteId}`);

    timer.start(`page_load ${noteId}`);
    await page.waitForSelector(
      CONFIG.RETURN_NOTES.SELECTORS.DETAILS_PAGE_INDICATOR,
      {
        visible: true,
        timeout: 15000,
      }
    );
    timer.end(`page_load ${noteId}`);

    timer.start(`table_config ${noteId}`);
    await page.waitForSelector(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, {
      visible: true,
    });
    await page.select(CONFIG.RETURN_NOTES.SELECTORS.DROPDOWN, "50");
    timer.end(`table_config ${noteId}`);

    timer.start(`data_extraction ${noteId}`);
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
    timer.end(`data_extraction ${noteId}`);

    timer.end(`processReturnNote ${noteId}`);

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
    timer.end(`processReturnNote ${noteId}`);
    console.error(`Error processing note ${noteId}:`, error);
    throw error;
  }
}

async function main() {
  let browser;
  let db;

  try {
    // Initialize database
    const Database = new ReturnNotesDatabase();
    db = await Database.initialize(dbPath);

    // Initialize browser
    timer.start("total_execution");
    timer.start("browser_launch");

    browser = await puppeteer.launch(browserConfig);

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Execute workflow
    await login(page);
    const returnNotes = await getReturnNotes(page);

    // Save to database
    timer.start("database_save");
    for (const note of returnNotes) {
      await db.saveReturnNote(
        note.returnNoteId,
        note.url,
        note.processedAt,
        note.parcels
      );
    }
    timer.end("database_save");

    timer.end("total_execution");
    timer.logMetrics();

    console.log(`Successfully processed ${returnNotes.length} return notes.`);
    console.log("Data saved to SQLite database: return_notes.db");
  } catch (error) {
    console.error("Script failed:", error);
    if (isCI) {
      // Save error state for GitHub Actions
      fs.writeFileSync(
        isCI ? "/github/workspace/.github/private/error.json" : "./error.json",
        JSON.stringify({ error: error.message, stack: error.stack }, null, 2)
      );
    }
    process.exit(1);
  } finally {
    if (!isCI) {
      // Manual cleanup in local mode
      if (browser) await browser.close();
      if (db) await db.close();
    }
  }
}

// Run the main function
main().catch(console.error);
