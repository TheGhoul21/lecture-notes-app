const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'lecture_notes.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS processed_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id TEXT UNIQUE,
        file_name TEXT,
        latex_output TEXT,
        transcription TEXT,
        refined TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
});

function addProcessedVideo(fileId, fileName, latexOutput, transcription, refined) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO processed_videos (file_id, file_name, latex_output, transcription, refined) 
      VALUES (?, ?, ?, ?, ?)`,
      [fileId, fileName, latexOutput, transcription, refined||''],
      function (err) {
        if (err) {
          reject(err);
        } else {
          // If it was an insert, the lastID will be the ID of the new row
          // If it was an update, the lastID will be 0
          resolve(this.lastID || 0);
        }
      }
    );
  });
}

function getProcessedVideos() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM processed_videos', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
}

function getProcessedVideo(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM processed_videos WHERE id = ?', [id], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function getProcessedVideoByFileId(fileId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM processed_videos WHERE file_id = ?', [fileId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function closeDB() {
  db.close();
}

module.exports = { addProcessedVideo, getProcessedVideos, getProcessedVideo,getProcessedVideoByFileId, closeDB };