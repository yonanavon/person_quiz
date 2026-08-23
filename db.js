// שכבת מסד נתונים: PostgreSQL כשמוגדר DATABASE_URL (Railway), אחרת SQLite מקומי.
// ממשק אחיד: query(sql, params) עם placeholders בסגנון $1, $2...

const usePg = !!process.env.DATABASE_URL;
let pool = null;
let sqlite = null;

// זיהוי פריסה: ב-Railway המערכת הקבצים אפמרלית, ולכן SQLite שם אינו אחסון —
// הוא מחיקה מתוזמנת. RAILWAY_ENVIRONMENT מוזרק אוטומטית על ידי Railway.
const IS_DEPLOYED = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

if (usePg) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  // ל-Pool יש מאזין שגיאות חובה: שגיאה בלקוח סרק (ניתוק רשת, restart של Postgres)
  // נפלטת כאירוע 'error', ובלי מאזין Node מפיל את התהליך כחריגה לא מטופלת.
  // הלקוח הפגום מוסר מה-Pool אוטומטית; הבקשה הבאה תפתח חיבור חדש.
  pool.on('error', (err) => {
    console.error('שגיאת חיבור ב-Postgres (הלקוח יוחלף אוטומטית):', err.message);
  });
} else if (IS_DEPLOYED && process.env.ALLOW_EPHEMERAL_DB !== 'true') {
  // כישלון מכוון בעלייה. קודם רק הזהרנו — והאזהרה נבלעה בלוג בזמן שהשרת
  // המשיך להגיש, כך שתוצאות תלמידים נמחקו בשקט בכל דיפלוי. מוטב שהדיפלוי
  // ייכשל ברעש מאשר שייראה תקין ויאבד נתונים.
  console.error('='.repeat(70));
  console.error('שגיאה: רץ בפריסה ללא DATABASE_URL — השרת לא יעלה.');
  console.error('');
  console.error('ללא PostgreSQL הנתונים נשמרים ב-SQLite על דיסק אפמרלי,');
  console.error('וכל דיפלוי או הפעלה מחדש מוחק את כל תוצאות התלמידים.');
  console.error('');
  console.error('פתרון ב-Railway:');
  console.error('  1. + New → Database → PostgreSQL');
  console.error('  2. בשירות האפליקציה: Variables → Add Variable Reference → DATABASE_URL');
  console.error('  3. Redeploy');
  console.error('');
  console.error('לעקיפה מודעת (נתונים ימחקו!): ALLOW_EPHEMERAL_DB=true');
  console.error('='.repeat(70));
  process.exit(1);
} else {
  if (IS_DEPLOYED) {
    console.warn('אזהרה: ALLOW_EPHEMERAL_DB=true — הנתונים על דיסק אפמרלי ויימחקו בכל דיפלוי.');
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

  // גישת מורה מקצועית לכיתה בודדת. הסיסמה נבחרת על ידי המורה בכניסה הראשונה
  // ונשמרת כ-scrypt (salt$hash) — לעולם לא כטקסט גלוי.
  // NULL בעמודה = הכיתה עדיין ממתינה לקביעת סיסמה.
  await addColumn('classes', 'teacher_password', 'TEXT');
  await addColumn('classes', 'teacher_password_set_at', 'TIMESTAMP');
}

// הוספת עמודה אידמפוטנטית — שני המנועים זורקים שגיאה אם העמודה כבר קיימת.
// ב-Postgres מזוהה לפי קוד SQLSTATE 42701 (duplicate_column) ולא לפי טקסט ההודעה,
// שמשתנה בין גרסאות ובין הגדרות שפה בשרת. ב-SQLite אין קודים — שם אין ברירה
// אלא להתאים טקסט ("duplicate column name").
async function addColumn(table, column, definition) {
  try {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    if (usePg && e && e.code === '42701') return;
    const msg = String(e && e.message || '').toLowerCase();
    if (!msg.includes('duplicate') && !msg.includes('already exists')) throw e;
  }
}

module.exports = { query, init, usePg };
