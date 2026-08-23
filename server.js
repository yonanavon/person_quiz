const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const Q = require('./questions');
const { computeProfile } = require('./scoring');
const interp = require('./interpretations');
const ai = require('./ai');
const abilities = require('./abilities');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;

// בפרודקשן אין ברירות מחדל: סיסמת ברירת מחדל או סוד אקראי מתחלף הם כשל אבטחה,
// לא אי-נוחות — עדיף שהשרת יסרב לעלות מאשר שיגיש נתוני תלמידים עם admin1234.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PROD ? null : 'admin1234');
const SESSION_SECRET = process.env.SESSION_SECRET
  || (IS_PROD ? null : crypto.randomBytes(32).toString('hex'));

const configErrors = [];
if (!ADMIN_PASSWORD) configErrors.push('ADMIN_PASSWORD חייב להיות מוגדר בפריסה (ללא ברירת מחדל).');
else if (IS_PROD && ADMIN_PASSWORD.length < 8) configErrors.push('ADMIN_PASSWORD קצר מדי — נדרשים 8 תווים לפחות.');
if (!SESSION_SECRET) configErrors.push('SESSION_SECRET חייב להיות מוגדר בפריסה, אחרת כל הפעלה מחדש מנתקת את המורה.');
if (configErrors.length) {
  console.error('שגיאת תצורה — השרת לא יעלה:');
  for (const e of configErrors) console.error('  • ' + e);
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.warn('אזהרה: SESSION_SECRET לא מוגדר — נוצר סוד אקראי זמני, ההתחברות לא תשרוד הפעלה מחדש.');
}

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- אימות: עוגיה חתומה ----
// שני תפקידים: 'admin' (מנהל המערכת, רואה הכול) ו-'teacher:<classId>' (מורה
// שרואה אך ורק את הכיתה שלו). התפקיד נשמר בתוך המטען החתום, ולכן לקוח
// לא יכול לשדרג את עצמו — שינוי המטען פוסל את החתימה.
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}
function makeToken(role = 'admin') {
  const payload = `${role}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
// מחזיר { role, classId } או null. classId קיים רק לתפקיד מורה.
function readToken(token) {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const parts = payload.split('.');
  const ts = Number(parts[parts.length - 1]);
  if (!(Date.now() - ts < 1000 * 60 * 60 * 12)) return null; // 12 שעות
  const role = parts[0];
  if (role === 'admin') return { role: 'admin', classId: null };
  if (role === 'teacher') {
    const classId = Number(parts[1]);
    if (!Number.isInteger(classId)) return null;
    return { role: 'teacher', classId };
  }
  return null;
}
function verifyToken(token) {
  return !!readToken(token);
}

// ---- סיסמת מורה: scrypt עם salt לכל כיתה ----
// סיסמאות שמורים בוחרים בעצמם נוטות להיות חלשות וחוזרות על עצמן, ומאחוריהן
// נתונים רגישים של קטינים. scrypt יקר בכוונה, כך שניחוש בכוח גס אינו כדאי.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex');
  return `${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes('$')) return false;
  const [salt, hash] = stored.split('$');
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex');
  } catch { return false; }
  if (derived.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

// סף מינימלי לסיסמה שהמורה בוחר. לא מדיניות מורכבת שרק מייצרת פתקים על המסך,
// אלא חסימת הבחירות הצפויות באמת ("1234", שם הכיתה, קוד הכיתה).
const WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'qwertyui', 'abcd1234',
  '11111111', '87654321', 'aaaaaaaa', 'teacher1', '12341234',
]);
function passwordProblem(password, classCode) {
  const pw = (password || '').toString();
  if (pw.length < 8) return 'הסיסמה חייבת להכיל לפחות 8 תווים';
  if (pw.length > 200) return 'סיסמה ארוכה מדי';
  if (WEAK_PASSWORDS.has(pw.toLowerCase())) return 'הסיסמה נפוצה מדי — בחר סיסמה אחרת';
  if (classCode && pw.trim() === classCode.toString().trim()) {
    return 'הסיסמה אינה יכולה להיות זהה לקוד הכיתה — התלמידים מכירים אותו';
  }
  if (/^(.)\1+$/.test(pw)) return 'הסיסמה חייבת להכיל יותר מתו אחד חוזר';
  return null;
}
// Secure מתווסף רק בפרודקשן — ב-localhost (http) דפדפן מתעלם מעוגייה כזו והמורה לא יוכל להתחבר.
function cookie(nameValue, maxAgeSeconds) {
  return `${nameValue}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${IS_PROD ? '; Secure' : ''}`;
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
// מנהל בלבד — פעולות על פני כל הכיתות (יצירת כיתות, ניתוח AI, ייצוא מלא).
function requireAdmin(req, res, next) {
  const auth = readToken(getCookie(req, 'quiz_admin'));
  if (!auth) return res.status(401).json({ error: 'נדרשת התחברות' });
  if (auth.role !== 'admin') return res.status(403).json({ error: 'הפעולה מותרת למנהל המערכת בלבד' });
  req.auth = auth;
  next();
}

// מנהל או מורה. כל מטפל שמשתמש בזה חייב לסנן לפי req.auth דרך scopeClause/assertClassAccess,
// אחרת מורה אחד יראה נתונים של כיתה אחרת.
function requireTeacher(req, res, next) {
  const auth = readToken(getCookie(req, 'quiz_admin'));
  if (!auth) return res.status(401).json({ error: 'נדרשת התחברות' });
  req.auth = auth;
  next();
}

// סינון SQL לפי תפקיד: מנהל מקבל תנאי ריק, מורה מוגבל לכיתה שלו.
// מחזיר { clause, params } כדי שהמזהה יעבור כפרמטר ולא ישורשר לתוך ה-SQL.
function scopeClause(auth, column, startIndex = 1) {
  if (auth.role === 'admin') return { clause: '', params: [] };
  return { clause: ` AND ${column} = $${startIndex}`, params: [auth.classId] };
}

// בדיקת גישה לכיתה בודדת. מחזיר true אם מותר.
function canAccessClass(auth, classId) {
  return auth.role === 'admin' || auth.classId === Number(classId);
}

// ---- הגבלת קצב להתחברות ----
// יש סיסמה אחת בלבד לכל המערכת, ומאחוריה נתונים של קטינים — בלי הגבלה
// אפשר לנחש אותה בכוח גס. חלון נע פשוט בזיכרון; מספיק לשרת יחיד.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map(); // ip -> number[] (חותמות זמן של ניסיונות כושלים)

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}
function recentFailures(ip) {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  const kept = (loginAttempts.get(ip) || []).filter(t => t > cutoff);
  if (kept.length) loginAttempts.set(ip, kept); else loginAttempts.delete(ip);
  return kept;
}
function recordFailure(ip) {
  const kept = recentFailures(ip);
  kept.push(Date.now());
  loginAttempts.set(ip, kept);
}
// ניקוי תקופתי כדי שה-Map לא יגדל ללא גבול לאורך זמן
setInterval(() => {
  for (const ip of [...loginAttempts.keys()]) recentFailures(ip);
}, LOGIN_WINDOW_MS).unref();

// השוואה בזמן קבוע — מונעת דליפת אורך/תוכן הסיסמה דרך מדידת זמן תגובה
function safeEqual(a, b) {
  const ab = Buffer.from((a ?? '').toString(), 'utf8');
  const bb = Buffer.from((b ?? '').toString(), 'utf8');
  const len = Math.max(ab.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa); bb.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && ab.length === bb.length;
}

// ---- API לתלמיד ----

// השאלון ללא מטא-נתוני ניקוד (לא חושפים מיפוי סגנונות לתלמיד)
app.get('/api/quiz', (req, res) => {
  res.json({
    likertLabels: Q.LIKERT_LABELS,
    modules: [
      { key: 'communication', title: 'איך אני עם אנשים', type: 'choice',
        questions: Q.communication.map(q => ({ id: q.id, text: q.text, options: q.options.map(o => o.text) })) },
      { key: 'motivation', title: 'מה מניע אותי', type: 'choice',
        questions: Q.motivation.map(q => ({ id: q.id, text: q.text, options: q.options.map(o => o.text) })) },
      { key: 'learning', title: 'איך אני לומד', type: 'likert',
        questions: Q.learning.map(q => ({ id: q.id, text: q.text })) },
      { key: 'sel', title: 'קצת עליי', type: 'likert',
        questions: Q.sel.map(q => ({ id: q.id, text: q.text })) },
      { key: 'open', title: 'במילים שלי', type: 'open',
        questions: Q.open.map(q => ({ id: q.id, text: q.text })) },
    ],
  });
});

app.post('/api/class-check', async (req, res) => {
  const code = (req.body.code || '').toString().trim();
  if (!code) return res.status(400).json({ error: 'נא להזין קוד כיתה' });
  const rows = await db.query('SELECT id, name FROM classes WHERE code = $1', [code]);
  if (!rows.length) return res.status(404).json({ error: 'קוד כיתה לא נמצא. בדוק עם המורה.' });
  res.json({ classId: rows[0].id, className: rows[0].name });
});

// שמירת שאלון — משמשת גם לטיוטה אוטומטית (submitted=0) וגם לשליחה סופית (submitted=1).
// בלי זה תלמיד שנטש לפני השאלות הפתוחות (המודול האחרון) לא היה מגיע למורה כלל,
// כי /api/submit נקרא רק ממסך הסיום.
async function saveSubmission({ name, classCode, answers, durationSeconds, submitted }) {
  const studentName = (name || '').toString().trim().slice(0, 60);
  if (!studentName) return { error: 'נא להזין שם', status: 400 };
  if (!answers || typeof answers !== 'object') return { error: 'חסרות תשובות', status: 400 };

  const cls = await db.query('SELECT id FROM classes WHERE code = $1', [(classCode || '').toString().trim()]);
  if (!cls.length) return { error: 'קוד כיתה לא תקין', status: 400 };
  const classId = cls[0].id;

  const profile = computeProfile(answers, Number(durationSeconds) || null);
  const now = db.usePg ? 'NOW()' : "datetime('now')";

  // טיוטה קיימת מאותו תלמיד באותה כיתה מתעדכנת במקום ליצור כפילות.
  // שליחה סופית קודמת לעולם לא נדרסת — תלמיד שממלא פעמיים ייווצר כרשומה נפרדת,
  // וזו החלטה מכוונת: עדיף שהמורה יראה שתי תשובות מאשר שהראשונה תיעלם.
  const draft = await db.query(
    'SELECT id FROM submissions WHERE student_name = $1 AND class_id = $2 AND submitted = 0',
    [studentName, classId]);

  if (draft.length) {
    await db.query(
      `UPDATE submissions SET answers = $1, profile = $2, duration_seconds = $3,
       submitted = $4, updated_at = ${now} WHERE id = $5`,
      [JSON.stringify(answers), JSON.stringify(profile), Number(durationSeconds) || null,
       submitted ? 1 : 0, draft[0].id]);
    return { ok: true, id: draft[0].id };
  }

  await db.query(
    `INSERT INTO submissions (student_name, class_id, answers, profile, duration_seconds, submitted, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, ${now})`,
    [studentName, classId, JSON.stringify(answers), JSON.stringify(profile),
     Number(durationSeconds) || null, submitted ? 1 : 0]);
  return { ok: true };
}

app.post('/api/submit', async (req, res) => {
  try {
    const { name, classCode, answers, durationSeconds } = req.body || {};
    const result = await saveSubmission({ name, classCode, answers, durationSeconds, submitted: true });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  } catch (e) {
    console.error('submit failed:', e);
    res.status(500).json({ error: 'שגיאה בשמירה, נסה שוב' });
  }
});

// שמירת טיוטה אוטומטית באמצע השאלון. נקראת גם דרך sendBeacon בנטישה,
// ולכן חייבת להיות זולה, אידמפוטנטית, ולא להחזיר שגיאה שתקפיץ משהו לתלמיד.
app.post('/api/submit-draft', async (req, res) => {
  try {
    const { name, classCode, answers, durationSeconds } = req.body || {};
    const result = await saveSubmission({ name, classCode, answers, durationSeconds, submitted: false });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  } catch (e) {
    console.error('draft save failed:', e);
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

// ---- API תחנות משחק ("אתגרי חשיבה") ----
// תחנות המשחק ב-public/games/ הן עצמאיות לחלוטין; זו נקודת הקצה היחידה שהן צריכות.

// רק חמש התחנות הקיימות — מונע הצפת הטבלה בערכי station שרירותיים
const STATIONS = new Set(['corsi', 'digit-span', 'symbol-speed', 'go-no-go', 'matrix']);

// הגבלת קצב לשמירת תוצאות: כיתה שלמה עובדת במקביל, ולכן הסף רחב.
// המטרה היא לעצור סקריפט שמציף, לא תלמיד שמשחק שוב.
const GAME_WINDOW_MS = 10 * 60 * 1000;
const GAME_MAX_PER_WINDOW = 40;
const gamePosts = new Map(); // ip -> number[]
setInterval(() => {
  const cutoff = Date.now() - GAME_WINDOW_MS;
  for (const [ip, arr] of [...gamePosts]) {
    const kept = arr.filter(t => t > cutoff);
    if (kept.length) gamePosts.set(ip, kept); else gamePosts.delete(ip);
  }
}, GAME_WINDOW_MS).unref();

app.post('/api/games/result', async (req, res) => {
  try {
    const ip = clientIp(req);
    const cutoff = Date.now() - GAME_WINDOW_MS;
    const recent = (gamePosts.get(ip) || []).filter(t => t > cutoff);
    if (recent.length >= GAME_MAX_PER_WINDOW) {
      return res.status(429).json({ error: 'יותר מדי שליחות. נסה שוב בעוד כמה דקות.' });
    }
    recent.push(Date.now());
    gamePosts.set(ip, recent);

    const { name, classCode, station, metrics, reliability, durationSeconds } = req.body || {};
    const studentName = (name || '').toString().trim().slice(0, 60);
    const st = (station || '').toString().trim().slice(0, 30);
    if (!studentName) return res.status(400).json({ error: 'נא להזין שם' });
    if (!STATIONS.has(st)) return res.status(400).json({ error: 'תחנה לא מוכרת' });
    if (!metrics || typeof metrics !== 'object') return res.status(400).json({ error: 'חסרים נתונים' });

    // תוצאה חייבת להיות משויכת לכיתה קיימת — אחרת היא זבל שהמורה לא יראה ממילא
    const cls = await db.query('SELECT id FROM classes WHERE code = $1', [(classCode || '').toString().trim()]);
    if (!cls.length) return res.status(400).json({ error: 'קוד כיתה לא תקין' });

    // חסימת אחסון מנופח: המדדים כוללים מערך trials, אך לא בהיקף חריג
    const metricsJson = JSON.stringify(metrics);
    const reliabilityJson = reliability ? JSON.stringify(reliability) : null;
    if (metricsJson.length > 100000) return res.status(400).json({ error: 'נתוני התוצאה גדולים מדי' });

    await db.query(
      'INSERT INTO game_results (student_name, class_id, station, metrics, reliability, duration_seconds) VALUES ($1, $2, $3, $4, $5, $6)',
      [studentName, cls[0].id, st, metricsJson, reliabilityJson, Number(durationSeconds) || null]);
    res.json({ ok: true });
  } catch (e) {
    console.error('game result failed:', e);
    res.status(500).json({ error: 'שגיאה בשמירה, נסה שוב' });
  }
});

app.get('/api/admin/game-results', requireTeacher, async (req, res) => {
  const scope = scopeClause(req.auth, 'g.class_id');
  const rows = await db.query(
    `SELECT g.*, c.name AS class_name FROM game_results g
     LEFT JOIN classes c ON c.id = g.class_id
     WHERE 1=1${scope.clause} ORDER BY g.created_at DESC`, scope.params);
  res.json(rows.map(r => ({
    id: r.id, studentName: r.student_name, className: r.class_name || null,
    station: r.station, metrics: JSON.parse(r.metrics),
    reliability: r.reliability ? JSON.parse(r.reliability) : null,
    durationSeconds: r.duration_seconds, createdAt: r.created_at,
  })));
});

// ---- API למורה ----

// כניסת מנהל המערכת — סיסמה אחת, גישה לכל הכיתות.
app.post('/api/admin/login', (req, res) => {
  const ip = clientIp(req);
  const failures = recentFailures(ip);
  if (failures.length >= LOGIN_MAX_ATTEMPTS) {
    const waitMin = Math.ceil((failures[0] + LOGIN_WINDOW_MS - Date.now()) / 60000);
    return res.status(429).json({ error: `יותר מדי ניסיונות התחברות. נסה שוב בעוד כ-${waitMin} דקות.` });
  }
  if (!safeEqual(req.body.password || '', ADMIN_PASSWORD)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'סיסמה שגויה' });
  }
  loginAttempts.delete(ip);
  res.setHeader('Set-Cookie', cookie(`quiz_admin=${makeToken('admin')}`, 43200));
  res.json({ ok: true, role: 'admin' });
});

// בדיקת מצב כיתה לפני כניסת מורה — האם כבר נקבעה סיסמה.
// מכוון: אינו חושף אם הקוד קיים כלל, כדי שלא ישמש לגילוי קודי כיתות.
app.post('/api/teacher/check', async (req, res) => {
  const ip = clientIp(req);
  if (recentFailures(ip).length >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות. נסה שוב מאוחר יותר.' });
  }
  const code = (req.body.classCode || '').toString().trim();
  const rows = await db.query(
    'SELECT id, name, teacher_password FROM classes WHERE code = $1', [code]);
  if (!rows.length) {
    recordFailure(ip);
    return res.status(404).json({ error: 'קוד כיתה לא תקין' });
  }
  res.json({ className: rows[0].name, needsSetup: !rows[0].teacher_password });
});

// כניסת מורה כיתה. בכניסה הראשונה המורה קובע סיסמה (needsSetup), ומאותו רגע
// היא נדרשת. הסיסמה נשמרת כ-scrypt ולא ניתנת לשחזור — רק המנהל יכול לאפס.
app.post('/api/teacher/login', async (req, res) => {
  const ip = clientIp(req);
  const failures = recentFailures(ip);
  if (failures.length >= LOGIN_MAX_ATTEMPTS) {
    const waitMin = Math.ceil((failures[0] + LOGIN_WINDOW_MS - Date.now()) / 60000);
    return res.status(429).json({ error: `יותר מדי ניסיונות התחברות. נסה שוב בעוד כ-${waitMin} דקות.` });
  }

  const code = (req.body.classCode || '').toString().trim();
  const password = (req.body.password || '').toString();
  const rows = await db.query(
    'SELECT id, name, code, teacher_password FROM classes WHERE code = $1', [code]);
  if (!rows.length) {
    recordFailure(ip);
    return res.status(401).json({ error: 'קוד כיתה או סיסמה שגויים' });
  }
  const cls = rows[0];

  // כניסה ראשונה: קביעת הסיסמה. מוגן בכך שהחלון הזה נסגר לצמיתות אחרי הקביעה —
  // מי שמגיע ראשון הוא המורה שקיבל את הקוד ממך.
  if (!cls.teacher_password) {
    const confirm = (req.body.confirmPassword || '').toString();
    const problem = passwordProblem(password, cls.code);
    if (problem) return res.status(400).json({ error: problem, needsSetup: true });
    if (password !== confirm) {
      return res.status(400).json({ error: 'הסיסמאות אינן תואמות', needsSetup: true });
    }
    const now = db.usePg ? 'NOW()' : "datetime('now')";
    await db.query(
      `UPDATE classes SET teacher_password = $1, teacher_password_set_at = ${now} WHERE id = $2`,
      [hashPassword(password), cls.id]);
    loginAttempts.delete(ip);
    res.setHeader('Set-Cookie', cookie(`quiz_admin=${makeToken(`teacher.${cls.id}`)}`, 43200));
    return res.json({ ok: true, role: 'teacher', className: cls.name });
  }

  if (!verifyPassword(password, cls.teacher_password)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'קוד כיתה או סיסמה שגויים' });
  }
  loginAttempts.delete(ip);
  res.setHeader('Set-Cookie', cookie(`quiz_admin=${makeToken(`teacher.${cls.id}`)}`, 43200));
  res.json({ ok: true, role: 'teacher', className: cls.name });
});

// שינוי סיסמה על ידי המורה עצמו (דורש את הסיסמה הנוכחית).
app.post('/api/teacher/change-password', requireTeacher, async (req, res) => {
  if (req.auth.role !== 'teacher') {
    return res.status(400).json({ error: 'למנהל אין סיסמת כיתה לשינוי' });
  }
  const rows = await db.query('SELECT id, code, teacher_password FROM classes WHERE id = $1', [req.auth.classId]);
  if (!rows.length) return res.status(404).json({ error: 'הכיתה לא נמצאה' });
  const cls = rows[0];
  const current = (req.body.currentPassword || '').toString();
  const next = (req.body.newPassword || '').toString();
  if (!verifyPassword(current, cls.teacher_password)) {
    return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
  }
  const problem = passwordProblem(next, cls.code);
  if (problem) return res.status(400).json({ error: problem });
  const now = db.usePg ? 'NOW()' : "datetime('now')";
  await db.query(
    `UPDATE classes SET teacher_password = $1, teacher_password_set_at = ${now} WHERE id = $2`,
    [hashPassword(next), cls.id]);
  res.json({ ok: true });
});

// איפוס סיסמת מורה על ידי המנהל — מחזיר את הכיתה למצב "כניסה ראשונה".
app.post('/api/admin/classes/:id/reset-password', requireAdmin, async (req, res) => {
  await db.query(
    'UPDATE classes SET teacher_password = NULL, teacher_password_set_at = NULL WHERE id = $1',
    [Number(req.params.id)]);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', cookie('quiz_admin=', 0));
  res.json({ ok: true });
});

app.get('/api/admin/me', async (req, res) => {
  const auth = readToken(getCookie(req, 'quiz_admin'));
  if (!auth) return res.json({ loggedIn: false, aiEnabled: ai.aiEnabled() });
  let className = null;
  if (auth.role === 'teacher') {
    const rows = await db.query('SELECT name FROM classes WHERE id = $1', [auth.classId]);
    // הכיתה נמחקה בזמן שהמורה היה מחובר — הסשן כבר לא מצביע לכלום
    if (!rows.length) return res.json({ loggedIn: false, aiEnabled: ai.aiEnabled() });
    className = rows[0].name;
  }
  res.json({
    loggedIn: true,
    role: auth.role,
    className,
    // ניתוח AI נצרך ממכסת ה-API של המנהל, ולכן פתוח למנהל בלבד
    aiEnabled: auth.role === 'admin' && ai.aiEnabled(),
  });
});

app.get('/api/admin/classes', requireTeacher, async (req, res) => {
  const scope = scopeClause(req.auth, 'c.id');
  const rows = await db.query(
    `SELECT c.id, c.name, c.code, (c.teacher_password IS NOT NULL) AS has_password,
            COUNT(s.id) AS submissions
     FROM classes c LEFT JOIN submissions s ON s.class_id = c.id
     WHERE 1=1${scope.clause}
     GROUP BY c.id, c.name, c.code, c.teacher_password ORDER BY c.id`, scope.params);
  res.json(rows.map(r => ({
    id: r.id, name: r.name, code: r.code, submissions: r.submissions,
    hasPassword: !!r.has_password,
  })));
});

app.post('/api/admin/classes', requireAdmin, async (req, res) => {
  const name = (req.body.name || '').toString().trim().slice(0, 60);
  const code = (req.body.code || '').toString().trim().slice(0, 20);
  if (!name || !code) return res.status(400).json({ error: 'נדרשים שם כיתה וקוד' });
  try {
    await db.query('INSERT INTO classes (name, code) VALUES ($1, $2)', [name, code]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'הקוד כבר קיים — בחר קוד אחר' });
  }
});

app.get('/api/admin/submissions', requireTeacher, async (req, res) => {
  const scope = scopeClause(req.auth, 's.class_id');
  const rows = await db.query(
    `SELECT s.id, s.student_name, s.duration_seconds, s.created_at, s.profile, s.submitted,
            (s.ai_analysis IS NOT NULL) AS has_ai, c.name AS class_name, c.id AS class_id
     FROM submissions s JOIN classes c ON c.id = s.class_id
     WHERE 1=1${scope.clause}
     ORDER BY s.created_at DESC`, scope.params);
  res.json(rows.map(r => {
    const p = JSON.parse(r.profile);
    return {
      id: r.id, studentName: r.student_name, className: r.class_name, classId: r.class_id,
      createdAt: r.created_at, durationSeconds: r.duration_seconds,
      hasAi: !!r.has_ai, tooFast: p.meta.tooFast,
      // טיוטה = התלמיד לא סיים ולא לחץ "שליחה"; המורה צריך לדעת שזו תמונה חלקית
      abandoned: !r.submitted,
      partial: !!p.meta.partial,
      completionRate: p.meta.completionRate ?? null,
      primaryStyle: Q.COMM_STYLES[p.communication.primary] || '—',
      topMotivator: p.motivation.insufficient ? '—' : (Q.MOTIVATORS[p.motivation.ranked[0]] || '—'),
      alerts: p.sel.alerts.map(a => Q.SEL_SCALES[a]),
    };
  }));
});

// פרופיל יכולות לתלמיד, כולל אחוזונים מול שאר הכיתה.
// השיוך בין תוצאת משחק לתלמיד הוא לפי שם + כיתה (אין למשחקים מזהה תלמיד).
async function abilityProfileFor(studentName, classId) {
  const rows = await db.query(
    `SELECT station, metrics, reliability, duration_seconds, created_at, student_name
     FROM game_results WHERE class_id = $1`, [classId]);

  const parsed = rows.map(r => ({
    studentName: r.student_name,
    station: r.station,
    metrics: safeParse(r.metrics),
    reliability: safeParse(r.reliability),
    durationSeconds: r.duration_seconds,
    createdAt: r.created_at,
  }));

  const mine = parsed.filter(r => r.studentName === studentName);
  if (!mine.length) return null;

  // ציוני הכיתה לכל תחנה — ניסיון אחרון בלבד לכל תלמיד, כדי שלא יוטה על ידי חזרות
  const peerScores = {};
  for (const st of abilities.STATION_ORDER) {
    const latestPer = new Map();
    for (const r of parsed.filter(x => x.station === st)) {
      const prev = latestPer.get(r.studentName);
      if (!prev || new Date(r.createdAt) > new Date(prev.createdAt)) latestPer.set(r.studentName, r);
    }
    peerScores[st] = [...latestPer.values()]
      .map(r => abilities.rawScore(st, r.metrics))
      .filter(v => v != null);
  }
  return abilities.buildAbilityProfile(mine, peerScores);
}

function safeParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v; // Postgres jsonb מגיע כאובייקט
  try { return JSON.parse(v); } catch { return null; }
}

app.get('/api/admin/submissions/:id', requireTeacher, async (req, res) => {
  const rows = await db.query(
    `SELECT s.*, c.name AS class_name FROM submissions s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`,
    [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'לא נמצא' });
  const r = rows[0];
  // 404 ולא 403 — מורה לא אמור ללמוד מהתשובה שהמזהה קיים בכיתה אחרת
  if (!canAccessClass(req.auth, r.class_id)) return res.status(404).json({ error: 'לא נמצא' });
  const ability = await abilityProfileFor(r.student_name, r.class_id);
  res.json({
    id: r.id, studentName: r.student_name, className: r.class_name,
    createdAt: r.created_at, durationSeconds: r.duration_seconds,
    abandoned: !r.submitted,
    updatedAt: r.updated_at || null,
    profile: JSON.parse(r.profile),
    ability,
    minPeers: abilities.MIN_PEERS_FOR_PERCENTILE,
    aiAnalysis: r.ai_analysis || null,
    aiAnalyzedAt: r.ai_analyzed_at || null,
    labels: { comm: Q.COMM_STYLES, motiv: Q.MOTIVATORS, axes: Q.LEARNING_AXES, sel: Q.SEL_SCALES },
    interpretations: interp,
    openQuestions: Q.open,
  });
});

app.delete('/api/admin/submissions/:id', requireTeacher, async (req, res) => {
  const rows = await db.query('SELECT class_id FROM submissions WHERE id = $1', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'לא נמצא' });
  if (!canAccessClass(req.auth, rows[0].class_id)) return res.status(404).json({ error: 'לא נמצא' });
  await db.query('DELETE FROM submissions WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ניתוח AI היברידי — לפי דרישה בלבד
app.post('/api/admin/analyze/:id', requireAdmin, async (req, res) => {
  if (!ai.aiEnabled()) return res.status(400).json({ error: 'ניתוח AI לא מוגדר (חסר ANTHROPIC_API_KEY)' });
  const rows = await db.query(
    `SELECT s.*, c.name AS class_name FROM submissions s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`,
    [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'לא נמצא' });
  const r = rows[0];
  try {
    // פרופיל היכולות נכנס לניתוח — שם נוצרים השילובים המעניינים
    // (למשל: מסוגלות עצמית נמוכה + חשיבה מופשטת גבוהה)
    const ability = await abilityProfileFor(r.student_name, r.class_id);
    const analysis = await ai.analyzeProfile(
      r.student_name, r.class_name, JSON.parse(r.profile), ability);
    await db.query(
      `UPDATE submissions SET ai_analysis = $1, ai_analyzed_at = ${db.usePg ? 'NOW()' : "datetime('now')"} WHERE id = $2`,
      [analysis, r.id]);
    res.json({ analysis });
  } catch (e) {
    console.error('AI analysis failed:', e);
    res.status(502).json({ error: 'ניתוח ה-AI נכשל, נסה שוב מאוחר יותר' });
  }
});

// תצוגת כיתה — התפלגויות
app.get('/api/admin/class-overview/:classId', requireTeacher, async (req, res) => {
  if (!canAccessClass(req.auth, req.params.classId)) {
    return res.status(404).json({ error: 'לא נמצא' });
  }
  const rows = await db.query(
    'SELECT profile, submitted FROM submissions WHERE class_id = $1', [Number(req.params.classId)]);
  const styleDist = {}; const motivDist = {};
  let redFlags = 0; let partial = 0; let abandoned = 0;
  for (const r of rows) {
    // טיוטות נספרות בנפרד ולא נכנסות להתפלגויות — הן תמונה לא גמורה
    if (!r.submitted) { abandoned++; continue; }
    const p = JSON.parse(r.profile);
    // פרופילים חלקיים לא נספרים בהתפלגות — אחרת סגנון שרירותי מעוות את תמונת הכיתה
    if (p.communication.primary) {
      styleDist[p.communication.primary] = (styleDist[p.communication.primary] || 0) + 1;
    }
    if (!p.motivation.insufficient && p.motivation.ranked[0]) {
      const top = p.motivation.ranked[0];
      motivDist[top] = (motivDist[top] || 0) + 1;
    }
    if (p.sel.alerts.length) redFlags++;
    if (p.meta.partial) partial++;
  }
  res.json({ count: rows.length - abandoned, abandoned, styleDist, motivDist, redFlags, partial,
    labels: { comm: Q.COMM_STYLES, motiv: Q.MOTIVATORS } });
});

// ייצוא CSV
app.get('/api/admin/export.csv', requireTeacher, async (req, res) => {
  const scope = scopeClause(req.auth, 's.class_id');
  const rows = await db.query(
    `SELECT s.*, c.name AS class_name FROM submissions s JOIN classes c ON c.id = s.class_id
     WHERE 1=1${scope.clause} ORDER BY s.created_at`, scope.params);
  const esc = v => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
  const header = ['שם', 'כיתה', 'תאריך', 'סטטוס', 'אחוז מילוי', 'סגנון ראשי', 'סגנון משני', 'מנוע 1', 'מנוע 2',
    'מסוגלות', 'התמדה', 'ויסות', 'שייכות', 'עזרה'].map(esc).join(',');
  const lines = rows.map(r => {
    const p = JSON.parse(r.profile);
    const m = p.motivation.insufficient ? [] : p.motivation.ranked;
    return [r.student_name, r.class_name, r.created_at,
      r.submitted ? 'הושלם' : 'לא הושלם',
      p.meta.completionRate != null ? p.meta.completionRate + '%' : '',
      Q.COMM_STYLES[p.communication.primary] || '', Q.COMM_STYLES[p.communication.secondary] || '',
      Q.MOTIVATORS[m[0]] || '', Q.MOTIVATORS[m[1]] || '',
      p.sel.scales.efficacy.avg, p.sel.scales.grit.avg, p.sel.scales.regulation.avg,
      p.sel.scales.belonging.avg, p.sel.scales.helpSeeking.avg].map(esc).join(',');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="results.csv"');
  res.send('﻿' + [header, ...lines].join('\n'));
});

// גם /admin וגם /admin/ מגישים את אותו דף. הנכסים ב-admin.html מופנים בנתיב מוחלט
// (/admin.js, /style.css) — בנתיב יחסי הדפדפן היה מחפש אותם תחת /admin/ ומקבל 404,
// והמורה היה נתקע במסך "טוען..." לבן.
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

db.init().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT} (${db.usePg ? 'Postgres' : 'SQLite'})`));
}).catch(e => {
  console.error('DB init failed:', e);
  process.exit(1);
});
