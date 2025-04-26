import sqlite3 from "sqlite3";
import fs from "fs";
import { getFirestore } from "firebase-admin/firestore";

// Helper function to run SQLite queries with promises
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/**
 * Saves invoices to SQLite database
 * @param {Array} invoices - Array of invoice objects
 */
export async function saveToSQLite(invoices) {
  const db = new sqlite3.Database("./invoices.db");

  try {
    // Create tables if they don't exist
    await runQuery(
      db,
      `CREATE TABLE IF NOT EXISTS invoices (
        invoice_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        parcels_count INTEGER,
        total_amount REAL,
        synced_to_firebase BOOLEAN DEFAULT FALSE,
        processedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    await runQuery(
      db,
      `CREATE TABLE IF NOT EXISTS parcels (
        parcel_id TEXT,
        invoice_id TEXT NOT NULL,
        status TEXT,
        city TEXT,
        amount REAL,
        synced_to_firebase BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (parcel_id, invoice_id),
        FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id) ON DELETE CASCADE
      )`
    );

    // Begin transaction
    await runQuery(db, "BEGIN TRANSACTION");

    for (const invoice of invoices) {
      // Insert or ignore invoice
      await runQuery(
        db,
        `INSERT OR IGNORE INTO invoices 
        (invoice_id, date, parcels_count, total_amount)
        VALUES (?, ?, ?, ?)`,
        [
          invoice.invoiceId,
          invoice.date,
          parseInt(invoice.parcelsNumber) || 0,
          parseFloat(invoice.total.replace("DH", "")) || 0,
        ]
      );

      // Insert parcels if they exist
      if (invoice.parcels?.length > 0) {
        for (const parcel of invoice.parcels) {
          await runQuery(
            db,
            `INSERT OR IGNORE INTO parcels
            (parcel_id, invoice_id, status, city, amount)
            VALUES (?, ?, ?, ?, ?)`,
            [
              parcel.parcelsNumber,
              invoice.invoiceId,
              parcel.status,
              parcel.city,
              parseFloat(parcel.total) || 0,
            ]
          );
        }
      }
    }

    await runQuery(db, "COMMIT");
    console.log(`✅ Saved ${invoices.length} invoices to SQLite`);
  } catch (error) {
    try {
      await runQuery(db, "ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }
    console.error("Error saving to SQLite:", error);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Saves invoices to Firestore and updates SQLite sync status
 * @param {Array} invoices - Array of invoice objects
 */
export async function saveInvoicesToFirestore(invoices) {
  let sqliteDb;

  try {
    // Initialize SQLite database
    sqliteDb = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database("./invoices.db", (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    // Initialize Firestore batch
    const firestoreDb = getFirestore();
    const batch = firestoreDb.batch();
    const invoicesRef = firestoreDb.collection("invoices");

    // Prepare all Firestore documents
    for (const invoice of invoices) {
      const invoiceRef = invoicesRef.doc(invoice.invoiceId);

      const invoiceData = {
        invoiceId: invoice.invoiceId,
        date: invoice.date || "Unknown",
        parcelsCount: parseInt(invoice.parcelsNumber) || 0,
        totalAmount: parseFloat(invoice.total.replace(" DH", "")) || 0,
        processedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };

      batch.set(invoiceRef, invoiceData, { ignoreUndefinedProperties: true });

      // Add parcels subcollection if they exist
      if (invoice.parcels?.length) {
        const parcelsRef = invoiceRef.collection("parcels");
        for (const parcel of invoice.parcels) {
          const parcelData = {
            parcelNumber: parcel.parcelsNumber || "Unknown",
            status: parcel.status || "Unknown",
            city: parcel.city || "Unknown",
            amount: parseFloat(parcel.total) || 0,
            lastUpdated: new Date().toISOString(),
          };
          batch.set(parcelsRef.doc(parcel.parcelsNumber), parcelData, {
            ignoreUndefinedProperties: true,
          });
        }
      }
    }

    // Commit Firestore batch
    await batch.commit();
    console.log(
      `✅ Successfully saved ${invoices.length} invoices to Firestore`
    );

    // Update sync status in SQLite
    await updateSyncStatus(sqliteDb, invoices);

    return true;
  } catch (error) {
    console.error("❌ Error saving to Firestore:", error);
    throw error;
  } finally {
    if (sqliteDb) {
      sqliteDb.close();
    }
  }
}

/**
 * Updates sync status in SQLite after successful Firestore upload
 */
async function updateSyncStatus(db, invoices) {
  try {
    await runQuery(db, "BEGIN TRANSACTION");

    // Prepare statements for efficient updates
    const invoiceStmt = db.prepare(
      "UPDATE invoices SET synced_to_firebase = 1 WHERE invoice_id = ?"
    );
    const parcelStmt = db.prepare(
      "UPDATE parcels SET synced_to_firebase = 1 WHERE invoice_id = ?"
    );

    // Execute updates
    for (const invoice of invoices) {
      await runQuery(invoiceStmt, [invoice.invoiceId]);

      if (invoice.parcels?.length) {
        await runQuery(parcelStmt, [invoice.invoiceId]);
      }
    }

    await runQuery(db, "COMMIT");
    console.log(`✅ Updated sync status for ${invoices.length} invoices`);
  } catch (error) {
    try {
      await runQuery(db, "ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }
    throw error;
  }
}

/**
 * Gets IDs of invoices already synced to Firestore
 * @returns {Array} Array of synced invoice IDs
 */
export async function getSyncedInvoiceIds() {
  if (!fs.existsSync("./invoices.db")) {
    return [];
  }

  const db = new sqlite3.Database("./invoices.db");

  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        "SELECT invoice_id FROM invoices WHERE synced_to_firebase = 1",
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    return rows.map((row) => row.invoice_id);
  } catch (error) {
    console.error("Error getting synced invoices:", error);
    return [];
  } finally {
    db.close();
  }
}
