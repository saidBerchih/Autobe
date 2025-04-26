// const sqlite3 = require("sqlite3");
import sqlite3 from "sqlite3";

export async function saveToSQLite(invoices) {
  const db = new sqlite3.Database("./invoices.db", (err) => {
    if (err) console.error("Database error:", err);
  });

  try {
    // Create tables with proper relationships
    await runQuery(
      db,
      `
      CREATE TABLE IF NOT EXISTS invoices (
        invoice_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        parcels_count INTEGER,
        total_amount REAL,
        synced_to_firebase BOOLEAN DEFAULT FALSE
        processedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    );

    await runQuery(
      db,
      `
      CREATE TABLE IF NOT EXISTS parcels (
        parcel_id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        status TEXT ,
        city TEXT,
        amount REAL,
        FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id)
      )
    `
    );

    // Insert data in transaction
    await runQuery(db, "BEGIN TRANSACTION");

    for (const invoice of invoices) {
      // Insert invoice
      await runQuery(
        db,
        `
        INSERT OR REPLACE INTO invoices 
        (invoice_id, date, parcels_count, total_amount)
        VALUES (?, ?, ?, ?,?)
      `,
        [
          invoice.invoiceId,
          invoice.date,
          parseInt(invoice.parcelsNumber) || 0,
          parseFloat(invoice.total.replace("DH", "")) || 0,
          false,
        ]
      );

      // Insert parcels if they exist
      if (invoice.parcels && invoice.parcels.length > 0) {
        for (const parcel of invoice.parcels) {
          await runQuery(
            db,
            `
            INSERT OR REPLACE INTO parcels
            (parcel_id, invoice_id, status, city, amount)
            VALUES (?, ?, ?, ?, ?)
          `,
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
    console.log("Data saved to SQLite successfully");
  } catch (error) {
    await runQuery(db, "ROLLBACK");
    console.error("Database error:", error);
  } finally {
    db.close();
  }
}
export async function saveInvoicesToFirestore(invoices) {
  const batch = db.batch();
  const invoicesRef = db.collection("invoices");

  for (const invoice of invoices) {
    const invoiceRef = invoicesRef.doc(invoice.invoiceId);

    // Prepare main invoice data
    const invoiceData = {
      invoiceId: invoice.invoiceId,
      date: invoice.date || "Unknown",
      parcelsCount: parseInt(invoice.parcelsNumber) || 0,
      totalAmount: parseFloat(invoice.total.replace(" DH", "")) || 0,
      processedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      syncedToFirebase: true, // Mark as synced
    };

    // Add invoice to batch
    batch.set(invoiceRef, cleanData(invoiceData), {
      ignoreUndefinedProperties: true,
    });

    // Add parcels as subcollection
    const parcelsRef = invoiceRef.collection("parcels");
    for (const parcel of invoice.parcels) {
      const parcelData = {
        parcelNumber: parcel.parcelsNumber || "Unknown",
        status: parcel.status || "Unknown",
        city: parcel.city || "Unknown",
        amount: parseFloat(parcel.total) || 0,
        lastUpdated: new Date().toISOString(),
      };

      batch.set(parcelsRef.doc(parcel.parcelsNumber), cleanData(parcelData), {
        ignoreUndefinedProperties: true,
      });
    }
  }

  try {
    await batch.commit();
    console.log(
      `✅ Successfully saved ${invoices.length} invoices to Firestore`
    );
    return true;
  } catch (error) {
    console.error("❌ Error saving to Firestore:", error);
    throw error;
  }
}
export async function getSyncedInvoiceIds() {
  // gets the orders that are in firestore
  try {
    // Check if database file exists
    if (!fs.existsSync("./invoices.db")) {
      console.log("Database doesn't exist yet - returning empty array");
      return [];
    }

    const db = new sqlite3.Database("./invoices.db");

    const ids = await new Promise((resolve, reject) => {
      db.all(
        "SELECT invoice_id FROM invoices WHERE synced_to_firebase = 1",
        (err, rows) => {
          db.close(); // Always close connection
          if (err) {
            console.error("Database error:", err.message);
            resolve([]); // Return empty array on error
          } else {
            resolve(rows?.map((row) => row.invoice_id) || []);
          }
        }
      );
    });

    return ids;
  } catch (error) {
    console.error("Error in getSyncedInvoiceIds:", error.message);
    return []; // Return empty array on any failure
  }
}

// Helper function to run queries with promises
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
