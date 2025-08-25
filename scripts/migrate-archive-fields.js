#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

async function migrateDatabase() {
    const dbPath = path.join(__dirname, '..', 'data', 'wingman.db');
    
    // Check if database exists
    try {
        await fs.access(dbPath);
        console.log(`Found database at: ${dbPath}`);
    } catch (error) {
        console.log('No database found. The archive fields will be added when the database is created.');
        return;
    }
    
    const db = new sqlite3.Database(dbPath);
    
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Check if archived column already exists
            db.all("PRAGMA table_info(sessions)", (err, columns) => {
                if (err) {
                    console.error('Error checking table structure:', err);
                    reject(err);
                    return;
                }
                
                const hasArchived = columns.some(col => col.name === 'archived');
                const hasArchivedAt = columns.some(col => col.name === 'archived_at');
                
                if (hasArchived && hasArchivedAt) {
                    console.log('Archive fields already exist in the database.');
                    db.close();
                    resolve();
                    return;
                }
                
                // Add archive fields if they don't exist
                const migrations = [];
                
                if (!hasArchived) {
                    migrations.push(new Promise((resolve, reject) => {
                        db.run("ALTER TABLE sessions ADD COLUMN archived BOOLEAN DEFAULT 0", (err) => {
                            if (err) {
                                console.error('Error adding archived column:', err);
                                reject(err);
                            } else {
                                console.log('✅ Added archived column to sessions table');
                                resolve();
                            }
                        });
                    }));
                }
                
                if (!hasArchivedAt) {
                    migrations.push(new Promise((resolve, reject) => {
                        db.run("ALTER TABLE sessions ADD COLUMN archived_at DATETIME", (err) => {
                            if (err) {
                                console.error('Error adding archived_at column:', err);
                                reject(err);
                            } else {
                                console.log('✅ Added archived_at column to sessions table');
                                resolve();
                            }
                        });
                    }));
                }
                
                // Execute all migrations
                Promise.all(migrations)
                    .then(() => {
                        console.log('✅ Database migration completed successfully!');
                        db.close();
                        resolve();
                    })
                    .catch((error) => {
                        console.error('Migration failed:', error);
                        db.close();
                        reject(error);
                    });
            });
        });
    });
}

// Run migration
console.log('Starting database migration for archive fields...');
migrateDatabase()
    .then(() => {
        console.log('Migration process completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });