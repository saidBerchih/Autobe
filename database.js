const sqlite3 = require("sqlite3").verbose();

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        VALUES (?, ?, ?, ?)
      `,
        [
          invoice.invoiceId,
          invoice.date,
          parseInt(invoice.parcelsNumber) || 0,
          parseFloat(invoice.total.replace("DH", "")) || 0,
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

// Helper function to run queries with promises
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

export async function getInvoiceWithParcels(invoiceId) {
  const db = new sqlite3.Database("./invoices.db");

  try {
    const invoice = await new Promise((resolve, reject) => {
      db.get(
        "SELECT * FROM invoices WHERE invoice_id = ?",
        [invoiceId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (invoice) {
      invoice.parcels = await new Promise((resolve, reject) => {
        db.all(
          "SELECT * FROM parcels WHERE invoice_id = ?",
          [invoiceId],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    }

    return invoice;
  } finally {
    db.close();
  }
}
