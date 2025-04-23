// database.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";

class ReturnNotesDatabase {
  constructor() {
    this.db = null;
  }

  async initialize() {
    this.db = await open({
      filename: "./Autobe12liveryOrders.db",
      driver: sqlite3.Database,
    });
    await this._createTables();
    return this;
  }

  async _createTables() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS return_notes (
        note_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        parcel_count INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS parcels (
        note_id TEXT NOT NULL,
        parcel_number TEXT NOT NULL UNIQUE,
        date TEXT ,
        city TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (note_id, parcel_number),
        FOREIGN KEY (note_id) REFERENCES return_notes(note_id)
      );
    `);
  }

  async saveReturnNote(noteId, url, processedAt, parcels) {
    await this.db.run(
      "INSERT OR REPLACE INTO return_notes (note_id, url, processed_at, parcel_count) VALUES (?, ?, ?, ?)",
      [noteId, url, processedAt, parcels.length]
    );

    for (const parcel of parcels) {
      await this.db.run(
        "INSERT OR REPLACE INTO parcels (note_id, parcel_number, date, city, status) VALUES (?, ?, ?, ?, ?)",
        [noteId, parcel.parcelNumber, parcel.date, parcel.city, parcel.status]
      );
    }
  }

  async close() {
    if (this.db) {
      await this.db.close();
    }
  }
}

export default ReturnNotesDatabase;
