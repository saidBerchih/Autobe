const puppeteer = require("puppeteer");
const fs = require("fs");
const { cert, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
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
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

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

    await saveToFirestore(returnNotes);

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

    // Get count from Firestore (1 read operation)
    const firestoreCount = await db
      .collection("returnNotes")
      .count()
      .get()
      .then((snapshot) => snapshot.data().count);

    if (noteIds.length === firestoreCount) {
      console.log("All notes already in Firestore - nothing to process");
      return [];
    }

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
function cleanData(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  );
}
async function saveToFirestore(returnNotes) {
  const batch = db.batch();
  const notesRef = db.collection("returnNotes");

  for (const note of returnNotes) {
    const noteRef = notesRef.doc(note.returnNoteId);

    // Filter out undefined values from note data
    const noteData = {
      url: note.url || null,
      processedAt: new Date().toISOString(),
      parcelCount: note.parcels?.length || 0,
    };

    batch.set(noteRef, cleanData(noteData));
    const parcelsRef = noteRef.collection("parcels");
    for (const parcel of note.parcels) {
      // Ensure all required fields have values
      const parcelData = {
        date: parcel.date || "Unkown",
        city: parcel.city || "Unknown",
        status: parcel.status || "Unknown",
        lastUpdated: new Date().toISOString(),
      };

      batch.set(parcelsRef.doc(parcel.parcelNumber), parcelData, {
        ignoreUndefinedProperties: true,
      });
    }
  }

  await batch.commit();
  console.log(`Saved ${returnNotes.length} notes to Firestore`);
}
