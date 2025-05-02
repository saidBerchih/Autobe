import puppeteer from "puppeteer";
import fs from "fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  getSyncedInvoiceIds,
  saveInvoicesToSQLite,
  saveInvoicesToFirestore,
} from "./database.js";
import {
  getSyncedReturnNoteIds,
  saveReturnNotesToFirestore,
  saveReturnNotesToSQLite,
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
      ROWS: " table > tbody > tr",
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
      parcels: parcels[0]?.parcelNumber?.length == 0 ? 0 : parcels,
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

    // const noteIds = await page.$$eval(
    //   CONFIG.RETURN_NOTES.SELECTORS.ROWS,
    //   (rows) => {
    //     return rows
    //       .filter((row) => {
    //         // Get the 5th td element (index 4) which contains the parcel count
    //         const parcelCountCell = row.cells[4];
    //         const parcelCount = parseInt(parcelCountCell.textContent.trim());
    //         return parcelCount > 0;
    //       })
    //       .map((row) => row.id)
    //       .filter(Boolean);
    //   }
    // );

    // console.log("notes");
    // console.log(noteIds);
    // console.log(noteIds.length);

    async function getUnsyncedReturnNotes(page) {
      try {
        const syncedReturnNoteIds = await getSyncedReturnNoteIds();

        console.log(`synced ids : ${syncedReturnNoteIds.lenght}`);

        const unsyncedNoteIds = await page.$$eval(
          CONFIG.RETURN_NOTES.SELECTORS.ROWS,
          (rows, syncedIdsJSON) => {
            const syncedSet = new Set(JSON.parse(syncedIdsJSON));
            return rows
              .filter((row) => {
                // Get the 5th td element (index 4) which contains the parcel count
                const parcelCountCell = row.cells[4];
                const parcelCount = parseInt(
                  parcelCountCell.textContent.trim()
                );
                return parcelCount > 0;
              })
              .map((row) => row.id)
              .filter(Boolean)
              .filter((id) => !syncedSet.has(id));
          },
          JSON.stringify(syncedReturnNoteIds)
        );

        console.log(
          `Processing ${unsyncedNoteIds.length} unsynced notes , synced notes : ${syncedReturnNoteIds.lenght}`
        );
        return unsyncedNoteIds;
      } catch (error) {
        console.error("Error filtering unsynced notes:", error);
        return [];
      }
    }

    // Usage
    const unsyncedReturnIds = await getUnsyncedReturnNotes(page);
    console.log(`unsyncedReturnIds : ${unsyncedReturnIds}`);

    // for (const noteId of unsyncedReturnIds) {
    //   try {
    //     const noteDetails = await processReturnNote(page, noteId);
    //     results.push(noteDetails);
    //   } catch (error) {
    //     console.error(`Error processing return note ${noteId}:`, error);
    //     continue;
    //   }
    // }

    return results;
  } catch (error) {
    throw error;
  }
}

function cleanData(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  );
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
    console.log(`synced invoices : ${syncedInvoiceIds.length}`);

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

    const returnNotes = await getReturnNotes(page);
    // await saveReturnNotesToFirestore(returnNotes);
    // await saveReturnNotesToSQLite(returnNotes);

    const invoices = await getInvoices(page);
    await saveInvoicesToSQLite(invoices);
    await saveInvoicesToFirestore(invoices);

    await browser.close();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();
