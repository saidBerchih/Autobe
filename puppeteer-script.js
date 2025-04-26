import puppeteer from "puppeteer";
import fs from "fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  getSyncedInvoiceIds,
  saveToSQLite,
  saveInvoicesToFirestore,
} from "./database.js";
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
      ROWS: ".row > table-responsive > table > tbody > tr",
      DROPDOWN: "select.custom-select",
      DETAILS_PAGE_INDICATOR: "#rn_added_parcels_table",
      TABLE_LOADED: "table.dataTable",
    },
  },
  INCOICES: {
    URL: "/invoices",
    SELECTORS: {
      ROWS: "table#inv_table > tbody > tr",
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

async function login(page) {
  console.log("login");
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
}

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
    const existingDocs = await db
      .collection("returnNotes")
      .select("__name__") // Only retrieve document IDs
      .get()
      .then((snapshot) => {
        console.timeEnd("FirestoreQuery");
        return snapshot.docs.map((doc) => doc.id);
      });

    // 3. Find difference using Set operations
    const existingSet = new Set(existingDocs);
    const notesToProcess = noteIds.filter((id) => !existingSet.has(id));

    for (const noteId of notesToProcess) {
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
//// invoices
async function processInvoices(page, note) {
  try {
    console.log("note" + note.invoiceId);
    // 1. Open the modal
    await page.goto(
      `${CONFIG.BASE_URL}${CONFIG.INCOICES.URL}?action=show&inv-ref=${note.invoiceId}`,
      {
        waitUntil: "networkidle2",
        timeout: 30000,
      }
    );

    // 2. Wait for modal content to load
    await page.waitForSelector(".row> .table-responsive > table ", {
      visible: true,
      timeout: 15000,
    });

    // 3. Extract data
    const parcels = await page.$$eval("table > tbody > tr", (rows) =>
      rows
        .map((row) => {
          const cells = row.querySelectorAll("td");
          if (!cells[4]?.textContent?.trim()) return;
          return {
            parcelsNumber: cells[1]?.textContent?.trim() || "N/A",
            status: cells[4]?.textContent?.trim() || "N/A",
            city: cells[5]?.textContent?.trim() || "N/A",
            total: cells[8]?.textContent?.trim().replace("DH", "") || "N/A",
          };
        })
        .filter((a) => a)
    );

    return {
      ...note,
      ["parcels"]: parcels,
    };
  } catch (error) {
    console.error(`Error processing note ${note.invoiceId}:`, error);
    await page.screenshot({
      path: `error-${note.invoiceId}-${Date.now()}.png`,
    });
    throw error;
  }
}
async function getInvoices(page) {
  console.log("geting invoices");

  const results = [];

  try {
    await page.goto(`${CONFIG.BASE_URL}${CONFIG.INCOICES.URL}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await page.waitForSelector(CONFIG.INCOICES.SELECTORS.DROPDOWN, {
      visible: true,
    });
    await page.select(CONFIG.INCOICES.SELECTORS.DROPDOWN, "100");

    const syncedInvoiceIds = await getSyncedInvoiceIds();

    const unsyncedInvoices = await page.$$eval(
      CONFIG.INCOICES.SELECTORS.ROWS,
      (rows, idsJSON) => {
        const idSet = new Set(JSON.parse(idsJSON));
        return rows
          .map((row) => {
            const cells = row.querySelectorAll("td");
            const invoiceId = cells[0]?.textContent.trim();
            return !idSet.has(invoiceId) // Changed to check for NON-synced invoices
              ? {
                  invoiceId,
                  date: cells[4]?.textContent.trim(),
                  status: cells[8]?.textContent.trim(),
                  parcelsNumber: cells[5]?.textContent.trim(),
                  total: cells[6]?.textContent.trim(),
                }
              : null;
          })
          .filter(Boolean); // Fixed: Keep only truthy values (non-null)
      },
      JSON.stringify(syncedInvoiceIds)
    );
    console.log(`Found ${unsyncedInvoices.length} synced invoices to process`);

    for (const invoice of unsyncedInvoices) {
      try {
        console.log("invoice.invoiceId : ");
        console.log(invoice.invoiceId);
        const invoiceDetails = await processInvoices(page, invoice);
        results.push(invoiceDetails);
      } catch (error) {
        continue;
      }
    }
    return results;
  } catch (error) {
    console.error("Error in getReturnNotes:", error);
    await page.screenshot({ path: "return-notes-error.png" });
    throw error;
  }
}

/// the main function
(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox"],
    });

    const page = await browser.newPage();
    await login(page);

    // const returnNotes = await getReturnNotes(page);

    // Create screenshots directory if not exists
    if (!fs.existsSync("screenshots")) {
      fs.mkdirSync("screenshots");
    }

    // await saveToFirestore(returnNotes);

    const invoices = await getInvoices(page);

    await saveToSQLite(invoices);
    await saveInvoicesToFirestore(invoices);

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
