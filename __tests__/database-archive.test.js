const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseManager } = require('../lib/database');

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-test-'));
  return path.join(dir, 'test.db');
}

describe('DatabaseManager archive lifecycle', () => {
  let db;

  beforeAll(async () => {
    db = new DatabaseManager(tempDbPath());
    await db.init();
  });

  afterAll(async () => {
    await db.close();
  });

  test('create, archive, restore session', async () => {
    const name = 'test-session-1';
    await db.createSession(name, null);

    let session = await db.getSession(name);
    expect(session).toBeTruthy();
    expect(session.archived).toBe(0);

    const archived = await db.archiveSession(name);
    expect(archived).toBe(true);

    session = await db.getSession(name);
    expect(session.archived).toBe(1);
    expect(session.archived_at).toBeTruthy();

    const restored = await db.restoreSession(name);
    expect(restored).toBe(true);

    session = await db.getSession(name);
    expect(session.archived).toBe(0);
    expect(session.archived_at).toBeNull();
  });

  test('deleteOldArchivedSessions removes old archived sessions', async () => {
    const oldName = 'archived-old';
    await db.createSession(oldName, null);
    await db.archiveSession(oldName);

    // Force archived_at to a very old date for deterministic behavior
    await db.run("UPDATE sessions SET archived_at = '2000-01-01 00:00:00' WHERE session_name = ?", [oldName]);

    // Should count/delete as older than 1 day
    const countBefore = await db.getOldArchivedSessionsCount(1);
    expect(countBefore).toBeGreaterThanOrEqual(1);

    const deleted = await db.deleteOldArchivedSessions(1);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const session = await db.getSession(oldName);
    expect(session).toBeFalsy();
  });
});
