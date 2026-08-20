// שכבת מסד נתונים: PostgreSQL כשמוגדר DATABASE_URL (Railway), אחרת SQLite מקומי.
// ממשק אחיד: query(sql, params) עם placeholders בסגנון $1, $2...

const usePg = !!process.env.DATABASE_URL;
let pool = null;
let sqlite = null;

if (usePg) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
} else {
  // אזהרה קריטית: ב-Railway המערכת הקבצים אפמרלית — SQLite ללא DATABASE_URL
  // אומר שכל דיפלוי/restart מוחק את כל תוצאות התלמידים בשקט.
  if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
    console.error('='.repeat(70));
    console.error('אזהרה חמורה: רץ בפרודקשן ללא DATABASE_URL — הנתונים נשמרים ב-SQLite מקומי');
    console.error('על דיסק אפמרלי. כל דיפלוי או הפעלה מחדש ימחק את כל תוצאות התלמידים!');
    console.error('פתרון: הוסיפו PostgreSQL ב-Railway וודאו ש-DATABASE_URL משותף לשירות.');
    console.error('='.repeat(70));
  }
  const { DatabaseSync } = require('node:sqlite');
  const path = process.env.DB_PATH || require('path').join(__dirname, 'data.db');
  sqlite = new DatabaseSync(path);
}

function toSqlitePlaceholders(sql) {
  return sql.replace(/\$\d+/g, '?');
}

async function query(sql, params = []) {
  if (usePg) {
    const res = await pool.query(sql, params);
    return res.rows;
  }
  const converted = toSqlitePlaceholders(sql);
  const stmt = sqlite.prepare(converted);
  if (/^\s*select/i.test(converted) || /returning/i.test(converted)) {
    return stmt.all(...params);
  }
  stmt.run(...params);
  return [];
}

async function init() {
  const serial = usePg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const now = usePg ? 'NOW()' : "(datetime('now'))";
  await query(`CREATE TABLE IF NOT EXISTS classes (
    id ${serial},
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT ${now}
  )`);
  await query(`CREATE TABLE IF NOT EXISTS game_results (
    id ${serial},
    student_name TEXT NOT NULL,
    class_id INTEGER,
    station TEXT NOT NULL,
    metrics TEXT NOT NULL,
    reliability TEXT,
    duration_seconds INTEGER,
    created_at TIMESTAMP DEFAULT ${now}
  )`);
  await query(`CREATE TABLE IF NOT EXISTS submissions (
    id ${serial},
    student_name TEXT NOT NULL,
    class_id INTEGER NOT NULL,
    answers TEXT NOT NULL,
    profile TEXT NOT NULL,
    duration_seconds INTEGER,
    ai_analysis TEXT,
    ai_analyzed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT ${now}
  )`);

  // submitted=0 מסמן טיוטה שנשמרה אוטומטית באמצע השאלון (התלמיד עוד לא לחץ "שליחה").
  // ALTER נפרד כדי שמסדי נתונים קיימים ישודרגו בלי לאבד נתונים.
  await addColumn('submissions', 'submitted', 'INTEGER NOT NULL DEFAULT 1');
  await addColumn('submissions', 'updated_at', 'TIMESTAMP');
}

// הוספת עמודה אידמפוטנטית — שני המנועים זורקים שגיאה אם העמודה כבר קיימת
async function addColumn(table, column, definition) {
  try {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    const msg = String(e && e.message || '').toLowerCase();
    if (!msg.includes('duplicate') && !msg.includes('already exists')) throw e;
  }
}

module.exports = { query, init, usePg };
