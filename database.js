import sqlite from "sqlite";
import sqlite3 from "sqlite3";
import fs from "fs";
import { getFirestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

// Common SQLite initialization with sqlite package
async function initializeDatabase(dbPath, schemaQueries) {
  const db = await sqlite.open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  try {
    await db.run("PRAGMA foreign_keys = ON");
    for (const query of schemaQueries) {
      await db.run(query);
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

// Invoices Operations with sqlite
export async function saveInvoicesToSQLite(invoices) {
  const db = await initializeDatabase("./invoices.db", [
    `CREATE TABLE IF NOT EXISTS invoices (
      invoice_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      parcels_count INTEGER,
      total_amount REAL,
      synced_to_firebase BOOLEAN DEFAULT FALSE,
      processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      validated BOOLEAN DEFAULT FALSE
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
  ]);

  try {
    await db.run("BEGIN TRANSACTION");

    for (const invoice of invoices) {
      const totalAmount =
        parseFloat(invoice.total.replace(/[^0-9.]/g, "")) || 0;

      await db.run(
        `INSERT OR REPLACE INTO invoices (
          invoice_id, date, parcels_count, total_amount, synced_to_firebase, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          invoice.invoiceId,
          invoice.date,
          parseInt(invoice.parcelsNumber) || 0,
          totalAmount,
          0,
          new Date().toISOString(),
        ]
      );

      if (invoice.parcels?.length) {
        for (const parcel of invoice.parcels) {
          await db.run(
            `INSERT OR REPLACE INTO parcels (
              parcel_id, invoice_id, status, city, amount, synced_to_firebase
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              parcel.parcelsNumber,
              invoice.invoiceId,
              parcel.status || "Unknown",
              parcel.city || "Unknown",
              parseFloat(parcel.total) || 0,
              0,
            ]
          );
        }
      }
    }

    await db.run("COMMIT");
    console.log(`✅ Saved ${invoices.length} invoices to SQLite`);
  } catch (error) {
    await db.run("ROLLBACK");
    throw new Error(`SQLite save failed: ${error.message}`);
  } finally {
    await db.close();
  }
}

// Return Notes Operations with sqlite
export async function saveReturnNotesToSQLite(returnNotes) {
  const db = await initializeDatabase("./return_notes.db", [
    `CREATE TABLE IF NOT EXISTS return_notes (
      return_note_id TEXT PRIMARY KEY,
      note_date TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      parcel_count INTEGER,
      synced_to_firebase BOOLEAN DEFAULT FALSE,
      validated BOOLEAN DEFAULT FALSE,
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
  ]);

  try {
    await db.run("BEGIN TRANSACTION");

    for (const note of returnNotes) {
      const noteDate = extractDateFromNoteId(note.returnNoteId);
      if (note.parcels?.length == 0) continue;

      await db.run(
        `INSERT OR REPLACE INTO return_notes (
          return_note_id, note_date, processed_at, parcel_count, synced_to_firebase, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          note.returnNoteId,
          noteDate,
          new Date().toISOString(),
          note.parcels?.length || 0,
          0,
          new Date().toISOString(),
        ]
      );

      if (note.parcels?.length) {
        for (const parcel of note.parcels) {
          await db.run(
            `INSERT OR REPLACE INTO return_parcels (
              parcel_number, return_note_id, date, city, status, last_updated, synced_to_firebase
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              parcel.parcelNumber,
              note.returnNoteId,
              parcel.date || "Unknown",
              parcel.city || "Unknown",
              parcel.status || "Unknown",
              new Date().toISOString(),
              0,
            ]
          );
        }
      }
    }

    await db.run("COMMIT");
    console.log(`✅ Saved ${returnNotes.length} return notes to SQLite`);
  } catch (error) {
    await db.run("ROLLBACK");
    throw new Error(`SQLite save failed: ${error.message}`);
  } finally {
    await db.close();
  }
}

// Sync Status Management with sqlite
async function updateInvoiceSyncStatus(invoices) {
  const db = await sqlite.open({
    filename: "./invoices.db",
    driver: sqlite3.Database,
  });

  try {
    await db.run("BEGIN TRANSACTION");

    for (const invoice of invoices) {
      await db.run(
        `UPDATE invoices SET synced_to_firebase = 1 WHERE invoice_id = ?`,
        [invoice.invoiceId]
      );

      await db.run(
        `UPDATE parcels SET synced_to_firebase = 1 WHERE invoice_id = ?`,
        [invoice.invoiceId]
      );
    }

    await db.run("COMMIT");
    console.log(`✅ Updated sync status for ${invoices.length} invoices`);
  } catch (error) {
    await db.run("ROLLBACK");
    throw error;
  } finally {
    await db.close();
  }
}

// Get Synced IDs with sqlite
export async function getSyncedInvoiceIds() {
  const dbPath = "./invoices.db";
  if (!fs.existsSync(dbPath)) return [];

  const db = await sqlite.open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  try {
    // Check if table exists
    const tableExists = await db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'`
    );

    if (!tableExists) {
      return [];
    }

    // Get synced invoice IDs
    const rows = await db.all(
      `SELECT invoice_id FROM invoices WHERE synced_to_firebase = 1`
    );

    return rows.map((row) => row.invoice_id);
  } catch (error) {
    console.error("Error getting synced invoice IDs:", error);
    return [];
  } finally {
    await db.close();
  }
}

export async function getSyncedReturnNoteIds() {
  const dbPath = "./return_notes.db";
  if (!fs.existsSync(dbPath)) return [];

  const db = await sqlite.open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  try {
    // Check if table exists
    const tableExists = await db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='return_notes'`
    );

    if (!tableExists) {
      return [];
    }

    // Get synced return note IDs
    const rows = await db.all(
      `SELECT return_note_id FROM return_notes WHERE synced_to_firebase = 1`
    );

    return rows.map((row) => row.return_note_id);
  } catch (error) {
    console.error("Error getting synced return note IDs:", error);
    return [];
  } finally {
    await db.close();
  }
}
