import sqlite3 from "sqlite3";
import fs from "fs";
import { getFirestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

// Helper function to run SQLite queries
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Common SQLite initialization
async function initializeDatabase(dbPath, schemaQueries) {
  const db = new sqlite3.Database(dbPath);
  try {
    await runQuery(db, "PRAGMA foreign_keys = ON");
    for (const query of schemaQueries) {
      await runQuery(db, query);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Common Firestore operations
async function executeFirestoreBatch(collectionName, items, processItem) {
  const firestoreDb = getFirestore();
  const batch = firestoreDb.batch();
  const collectionRef = firestoreDb.collection(collectionName);

  for (const item of items) {
    await processItem(batch, collectionRef, item);
  }

  await batch.commit();
  console.log(
    `✅ Successfully saved ${items.length} items to ${collectionName}`
  );
}

// Invoices Schema
const INVOICES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS invoices (
    invoice_id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    parcels_count INTEGER,
    total_amount REAL,
    synced_to_firebase BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS parcels (
    parcel_id TEXT,
    invoice_id TEXT NOT NULL,
    status TEXT,
    city TEXT,
    amount REAL,
    synced_to_firebase BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (parcel_id, invoice_id),
    FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id) ON DELETE CASCADE
  )`,
];

// Return Notes Schema
const RETURN_NOTES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS return_notes (
    return_note_id TEXT PRIMARY KEY,
    note_date TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    parcel_count INTEGER,
    synced_to_firebase BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS return_parcels (
    parcel_number TEXT,
    return_note_id TEXT NOT NULL,
    date TEXT,
    city TEXT,
    status TEXT,
    last_updated TEXT,
    synced_to_firebase BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (parcel_number, return_note_id),
    FOREIGN KEY (return_note_id) REFERENCES return_notes (return_note_id) ON DELETE CASCADE
  )`,
];

// Date extraction logic
function extractDateFromNoteId(noteId) {
  const datePart = noteId.split("-")[1]?.substring(0, 6) || "000000";
  const rawDay = parseInt(datePart.substring(0, 2));
  const month = parseInt(datePart.substring(2, 4));
  const year = 2000 + parseInt(datePart.substring(4, 6));

  // Business rule: Add 3 days to the raw day value
  const date = new Date(year, month - 1, rawDay + 3);

  return date.toISOString().split("T")[0].split("-").reverse().join("-");
}

// Invoices Operations
export async function saveInvoicesToSQLite(invoices) {
  const db = await initializeDatabase("./invoices.db", INVOICES_SCHEMA);

  try {
    await runQuery(db, "BEGIN TRANSACTION");

    const invoiceStmt = await db.prepare(
      "INSERT OR REPLACE INTO invoices VALUES (?, ?, ?, ?, ?, ?)"
    );
    const parcelStmt = await db.prepare(
      "INSERT OR REPLACE INTO parcels VALUES (?, ?, ?, ?, ?, ?)"
    );

    for (const invoice of invoices) {
      const totalAmount =
        parseFloat(invoice.total.replace(/[^0-9.]/g, "")) || 0;

      await invoiceStmt.run(
        invoice.invoiceId,
        invoice.date,
        parseInt(invoice.parcelsNumber) || 0,
        totalAmount,
        0,
        new Date().toISOString()
      );

      if (invoice.parcels?.length) {
        for (const parcel of invoice.parcels) {
          await parcelStmt.run(
            parcel.parcelsNumber,
            invoice.invoiceId,
            parcel.status || "Unknown",
            parcel.city || "Unknown",
            parseFloat(parcel.total) || 0,
            0
          );
        }
      }
    }

    await invoiceStmt.finalize();
    await parcelStmt.finalize();
    await runQuery(db, "COMMIT");
    console.log(`✅ Saved ${invoices.length} invoices to SQLite`);
  } catch (error) {
    await runQuery(db, "ROLLBACK");
    throw new Error(`SQLite save failed: ${error.message}`);
  } finally {
    db.close();
  }
}

export async function saveInvoicesToFirestore(invoices) {
  try {
    await executeFirestoreBatch(
      "invoices",
      invoices,
      async (batch, invoicesRef, invoice) => {
        const invoiceRef = invoicesRef.doc(invoice.invoiceId);
        const totalAmount =
          parseFloat(invoice.total.replace(/[^0-9.]/g, "")) || 0;

        batch.set(
          invoiceRef,
          {
            invoiceId: invoice.invoiceId,
            date: invoice.date || "Unknown",
            parcelsCount: parseInt(invoice.parcelsNumber) || 0,
            totalAmount,
            processedAt: FieldValue.serverTimestamp(),
            lastUpdated: FieldValue.serverTimestamp(),
          },
          { ignoreUndefinedProperties: true }
        );

        if (invoice.parcels?.length) {
          const parcelsRef = invoiceRef.collection("parcels");
          for (const parcel of invoice.parcels) {
            batch.set(
              parcelsRef.doc(parcel.parcelsNumber),
              {
                parcelNumber: parcel.parcelsNumber || "Unknown",
                status: parcel.status || "Unknown",
                city: parcel.city || "Unknown",
                amount: parseFloat(parcel.total) || 0,
                lastUpdated: FieldValue.serverTimestamp(),
              },
              { ignoreUndefinedProperties: true }
            );
          }
        }
      }
    );

    await updateSyncStatus("./invoices.db", "invoices", "parcels", invoices);
    return true;
  } catch (error) {
    throw new Error(`Firestore save failed: ${error.message}`);
  }
}

// Return Notes Operations
export async function saveReturnNotesToSQLite(returnNotes) {
  const db = await initializeDatabase("./return_notes.db", RETURN_NOTES_SCHEMA);

  try {
    await runQuery(db, "BEGIN TRANSACTION");

    const noteStmt = await db.prepare(
      "INSERT OR REPLACE INTO return_notes VALUES (?, ?, ?, ?, ?, ?)"
    );
    const parcelStmt = await db.prepare(
      "INSERT OR REPLACE INTO return_parcels VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    for (const note of returnNotes) {
      const noteDate = extractDateFromNoteId(note.returnNoteId);

      await noteStmt.run(
        note.returnNoteId,
        noteDate,
        new Date().toISOString(),
        note.parcels?.length || 0,
        0,
        new Date().toISOString()
      );

      if (note.parcels?.length) {
        for (const parcel of note.parcels) {
          await parcelStmt.run(
            parcel.parcelNumber,
            note.returnNoteId,
            parcel.date || "Unknown",
            parcel.city || "Unknown",
            parcel.status || "Unknown",
            new Date().toISOString(),
            0
          );
        }
      }
    }

    await noteStmt.finalize();
    await parcelStmt.finalize();
    await runQuery(db, "COMMIT");
    console.log(`✅ Saved ${returnNotes.length} return notes to SQLite`);
  } catch (error) {
    await runQuery(db, "ROLLBACK");
    throw new Error(`SQLite save failed: ${error.message}`);
  } finally {
    db.close();
  }
}

export async function saveReturnNotesToFirestore(returnNotes) {
  try {
    await executeFirestoreBatch(
      "returnNotes",
      returnNotes,
      async (batch, notesRef, note) => {
        const noteRef = notesRef.doc(note.returnNoteId);
        const noteDate = extractDateFromNoteId(note.returnNoteId);

        batch.set(
          noteRef,
          {
            date: noteDate,
            processedAt: FieldValue.serverTimestamp(),
            parcelCount: note.parcels?.length || 0,
            lastUpdated: FieldValue.serverTimestamp(),
          },
          { ignoreUndefinedProperties: true }
        );

        if (note.parcels?.length) {
          const parcelsRef = noteRef.collection("parcels");
          for (const parcel of note.parcels) {
            batch.set(
              parcelsRef.doc(parcel.parcelNumber),
              {
                date: parcel.date || "Unknown",
                city: parcel.city || "Unknown",
                status: parcel.status || "Unknown",
                lastUpdated: FieldValue.serverTimestamp(),
              },
              { ignoreUndefinedProperties: true }
            );
          }
        }
      }
    );

    await updateSyncStatus(
      "./return_notes.db",
      "return_notes",
      "return_parcels",
      returnNotes
    );
    return true;
  } catch (error) {
    throw new Error(`Firestore save failed: ${error.message}`);
  }
}

// Common Sync Status Management
async function updateSyncStatus(dbPath, mainTable, childTable, items) {
  const db = new sqlite3.Database(dbPath);

  try {
    await runQuery(db, "BEGIN TRANSACTION");

    const updateMain = await db.prepare(
      `UPDATE ${mainTable} SET synced_to_firebase = 1 WHERE ${
        mainTable === "invoices" ? "invoice_id" : "return_note_id"
      } = ?`
    );

    const updateChild = await db.prepare(
      `UPDATE ${childTable} SET synced_to_firebase = 1 WHERE ${
        mainTable === "invoices" ? "invoice_id" : "return_note_id"
      } = ?`
    );

    for (const item of items) {
      await updateMain.run(
        item[mainTable === "invoices" ? "invoiceId" : "returnNoteId"]
      );
      await updateChild.run(
        item[mainTable === "invoices" ? "invoiceId" : "returnNoteId"]
      );
    }

    await updateMain.finalize();
    await updateChild.finalize();
    await runQuery(db, "COMMIT");
    console.log(`✅ Updated sync status for ${items.length} ${mainTable}`);
  } catch (error) {
    await runQuery(db, "ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

// Common Sync Status Check
async function getSyncedIds(dbPath, tableName) {
  if (!fs.existsSync(dbPath)) return [];

  const db = new sqlite3.Database(dbPath);
  try {
    const tableExists = await runQuery(
      db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    if (tableExists.length === 0) {
      return [];
    }
    const rows = await runQuery(
      db,
      `SELECT ${
        tableName === "invoices" ? "invoice_id" : "return_note_id"
      } FROM ${tableName} WHERE synced_to_firebase = 1`
    );
    return rows.map(
      (row) => row[tableName === "invoices" ? "invoice_id" : "return_note_id"]
    );
  } catch (error) {
    console.error(`Error getting synced ${tableName}:`, error);
    return [];
  } finally {
    db.close();
  }
}

export const getSyncedInvoiceIds = () =>
  getSyncedIds("./invoices.db", "invoices");
export const getSyncedReturnNoteIds = () =>
  getSyncedIds("./return_notes.db", "return_notes");
