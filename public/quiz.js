// ממשק התלמיד — שאלה אחת בכל פעם עם פס התקדמות.

const app = document.getElementById('app');
let quizData = null;
let flatQuestions = []; // [{moduleKey, moduleTitle, type, id, text, options?, displayOrder?}]
let answers = {};
let current = 0;
let student = { name: '', classCode: '', className: '' };
let startTime = null;

function esc(v) {
  return (v ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- שמירה מקומית ----
// 43 שאלות, כ-15 דקות: רענון דף או נעילת מסך בטלפון מחקו עד כה את הכל.
// שומרים אחרי כל תשובה ומשחזרים בטעינה. נמחק מיד לאחר שליחה מוצלחת.
const SAVE_KEY = 'person-quiz-progress';
const SAVE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // טיוטה ישנה מיום = כנראה תלמיד אחר על אותו מכשיר

function saveProgress() {
  if (!student.name) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      student, answers, current, startTime,
      // סדר האפשרויות המעורבב — בלי זה השחזור יציג סדר אחר ויבלבל את התלמיד
      order: flatQuestions.map(q => q.displayOrder || null),
      savedAt: Date.now(),
    }));
  } catch (e) { /* מצב פרטי / אחסון מלא — ממשיכים בלי שמירה */ }
}

function clearProgress() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

// ---- סנכרון טיוטה לשרת ----
// localStorage מציל רק תלמיד שחוזר לאותו דפדפן. טיוטה בשרת מבטיחה שהמורה יראה
// את התשובות גם אם התלמיד נטש לתמיד — למשל בשאלות הפתוחות שהן המודול האחרון.
let lastDraftJson = '';
let submitted = false; // אחרי שליחה סופית אין לשלוח יותר טיוטות

function draftPayload() {
  return {
    name: student.name,
    classCode: student.classCode,
    answers,
    durationSeconds: startTime ? Math.round((Date.now() - startTime) / 1000) : null,
  };
}

// נשלח רק כשיש שינוי אמיתי בתשובות, כדי לא להציף את השרת
async function syncDraft() {
  if (submitted || !student.name || !Object.keys(answers).length) return;
  const payload = draftPayload();
  const json = JSON.stringify(payload.answers);
  if (json === lastDraftJson) return;
  lastDraftJson = json;
  try {
    await fetch('/api/submit-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    draftSent = true;
  } catch (e) { /* אופליין — localStorage עדיין מכסה, וננסה שוב בהמשך */ }
}

// נטישה: sendBeacon שורד סגירת טאב, בניגוד ל-fetch רגיל
function flushDraftOnExit() {
  if (submitted || !student.name || !Object.keys(answers).length) return;
  try {
    const blob = new Blob([JSON.stringify(draftPayload())], { type: 'application/json' });
    navigator.sendBeacon('/api/submit-draft', blob);
  } catch (e) {}
}

// pagehide/visibilitychange אמינים בנייד יותר מ-beforeunload
window.addEventListener('pagehide', flushDraftOnExit);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushDraftOnExit();
});

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.student || !d.student.name) return null;
    if (Date.now() - (d.savedAt || 0) > SAVE_MAX_AGE_MS) { clearProgress(); return null; }
    // מבנה השאלון השתנה מאז השמירה — הטיוטה כבר לא תואמת
    if (!Array.isArray(d.order) || d.order.length !== flatQuestions.length) { clearProgress(); return null; }
    return d;
  } catch (e) { return null; }
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה');
  return data;
}

async function loadQuiz() {
  quizData = await api('/api/quiz');
  flatQuestions = [];
  for (const mod of quizData.modules) {
    for (const q of mod.questions) {
      const item = { moduleKey: mod.key, moduleTitle: mod.title, type: mod.type, id: q.id, text: q.text };
      if (mod.type === 'choice') {
        item.options = q.options;
        // ערבוב סדר תצוגה — שומרים מיפוי לאינדקס המקורי
        item.displayOrder = shuffle(q.options.map((_, i) => i));
      }
      flatQuestions.push(item);
    }
  }
  const saved = loadProgress();
  if (saved) return renderResume(saved);
  renderWelcome();
}

function renderResume(saved) {
  const answered = Object.keys(saved.answers || {}).length;
  app.innerHTML = `
    <div class="card center">
      <div class="welcome-icon">📝</div>
      <h2>יש לך שאלון שלא הושלם</h2>
      <p class="subtitle">
        שלום ${esc(saved.student.name.split(' ')[0])}! התחלת למלא את השאלון וענית על
        <b>${esc(answered)}</b> שאלות.<br>רוצה להמשיך מהמקום שבו הפסקת?
      </p>
      <button class="btn" id="resume">המשך מהמקום שהפסקתי ←</button>
      <div style="margin-top:12px;">
        <button class="btn-ghost btn" id="fresh">התחלה מחדש</button>
      </div>
    </div>`;
  document.getElementById('resume').onclick = () => {
    student = saved.student;
    answers = saved.answers || {};
    current = Math.min(saved.current || 0, flatQuestions.length);
    startTime = saved.startTime || Date.now();
    // החזרת סדר האפשרויות המקורי כדי שהתצוגה תהיה זהה לפני ההפסקה
    saved.order.forEach((ord, i) => { if (ord && flatQuestions[i]) flatQuestions[i].displayOrder = ord; });
    renderQuestion();
  };
  document.getElementById('fresh').onclick = () => {
    clearProgress();
    answers = {};
    current = 0;
    renderWelcome();
  };
}

function renderWelcome() {
  app.innerHTML = `
    <div class="card">
      <div class="welcome-icon">👋</div>
      <h1 class="center">שאלון היכרות</h1>
      <p class="subtitle center">
        שלום! השאלון הזה עוזר למורה להכיר אותך טוב יותר —
        מה מתאים לך, מה מעניין אותך ואיך הכי נעים לך ללמוד.<br>
        <b>אין כאן תשובות נכונות או לא נכונות</b> — פשוט ענה מה שהכי מתאים לך באמת.<br>
        משך המילוי: כ-15 דקות. התשובות נשמרות אצל המורה בלבד.
      </p>
      <label>השם שלך (שם פרטי ומשפחה)</label>
      <input type="text" id="name" maxlength="60" placeholder="למשל: ישראל ישראלי">
      <label>קוד כיתה (מקבלים מהמורה)</label>
      <input type="text" id="code" maxlength="20" placeholder="הקוד שהמורה נתן">
      <div class="error" id="err"></div>
      <div class="center"><button class="btn" id="start">מתחילים! ←</button></div>
    </div>`;
  document.getElementById('start').onclick = async () => {
    const name = document.getElementById('name').value.trim();
    const code = document.getElementById('code').value.trim();
    const err = document.getElementById('err');
    err.textContent = '';
    if (!name) { err.textContent = 'נא למלא שם'; return; }
    if (!code) { err.textContent = 'נא למלא קוד כיתה'; return; }
    try {
      const check = await api('/api/class-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      student = { name, classCode: code, className: check.className };
      startTime = Date.now();
      current = 0;
      saveProgress();
      renderQuestion();
    } catch (e) {
      err.textContent = e.message;
    }
  };
}

function renderQuestion() {
  if (current >= flatQuestions.length) return renderSubmit();
  const q = flatQuestions[current];
  const pct = Math.round((current / flatQuestions.length) * 100);

  let optionsHtml = '';
  if (q.type === 'choice') {
    optionsHtml = q.displayOrder.map(origIdx => `
      <button class="option ${answers[q.id] === origIdx ? 'selected' : ''}" data-idx="${origIdx}">
        ${q.options[origIdx]}
      </button>`).join('');
  } else if (q.type === 'likert') {
    optionsHtml = '<div class="likert">' + quizData.likertLabels.map((label, i) => `
      <button class="option ${answers[q.id] === i + 1 ? 'selected' : ''}" data-idx="${i + 1}">
        ${label}
      </button>`).join('') + '</div>';
  } else {
    optionsHtml = `<textarea id="openAnswer" maxlength="2000" placeholder="כתוב כאן...">${esc(answers[q.id] || '')}</textarea>`;
  }

  app.innerHTML = `
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-text">שאלה ${current + 1} מתוך ${flatQuestions.length}</div>
    </div>
    <div class="card">
      <span class="module-badge">${q.moduleTitle}</span>
      <div class="question-text">${q.text}</div>
      ${optionsHtml}
      <div class="nav-row">
        <button class="btn-ghost btn" id="back" ${current === 0 ? 'disabled' : ''}>→ חזרה</button>
        ${q.type === 'open' ? '<button class="btn" id="next">המשך ←</button>' : '<span></span>'}
      </div>
    </div>`;

  document.getElementById('back').onclick = () => {
    if (current > 0) { current--; saveProgress(); renderQuestion(); }
  };

  if (q.type === 'open') {
    const ta = document.getElementById('openAnswer');
    // שמירה תוך כדי הקלדה — טקסט חופשי הוא מה שהכי כואב לאבד
    ta.oninput = () => { answers[q.id] = ta.value; saveProgress(); };
    document.getElementById('next').onclick = () => {
      answers[q.id] = ta.value;
      current++;
      saveProgress();
      syncDraft(); // כל שאלה פתוחה — כאן הנטישה הכי שכיחה
      renderQuestion();
    };
  } else {
    app.querySelectorAll('.option').forEach(btn => {
      btn.onclick = () => {
        answers[q.id] = Number(btn.dataset.idx);
        btn.classList.add('selected');
        setTimeout(() => {
          current++;
          saveProgress();
          // סנכרון לשרת כל 5 שאלות, ובוודאות במעבר בין מודולים
          const next = flatQuestions[current];
          if (current % 5 === 0 || !next || next.moduleKey !== q.moduleKey) syncDraft();
          renderQuestion();
        }, 180);
      };
    });
  }
  window.scrollTo(0, 0);
}

function renderSubmit() {
  app.innerHTML = `
    <div class="card center">
      <div class="welcome-icon">🎯</div>
      <h2>סיימת את כל השאלות!</h2>
      <p class="subtitle">לחץ על הכפתור כדי לשלוח את התשובות למורה.</p>
      <div class="error" id="err"></div>
      <button class="btn" id="send">שליחה</button>
    </div>`;
  document.getElementById('send').onclick = async () => {
    const btn = document.getElementById('send');
    btn.disabled = true;
    btn.textContent = 'שולח...';
    try {
      await api('/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: student.name,
          classCode: student.classCode,
          answers,
          durationSeconds: Math.round((Date.now() - startTime) / 1000),
        }),
      });
      clearProgress(); // נשלח בהצלחה — הטיוטה כבר לא נחוצה
      // מנטרל את שולחי הנטישה, אחרת סגירת הטאב תיצור טיוטה חדשה אחרי שכבר נשלח
      submitted = true;
      renderDone();
    } catch (e) {
      document.getElementById('err').textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'שליחה';
    }
  };
}

function renderDone() {
  // העברת השם וקוד הכיתה בכתובת, כדי שהתלמיד לא יצטרך להקליד שוב בכל תחנה.
  // URLSearchParams כבר מקודד את הערכים, ו-& מקודד ל-&amp; כנדרש בתוך מאפיין HTML.
  const qs = new URLSearchParams({ name: student.name, class: student.classCode })
    .toString().replace(/&/g, '&amp;');
  app.innerHTML = `
    <div class="card center">
      <div class="welcome-icon">🌟</div>
      <h1>תודה רבה, ${esc(student.name.split(' ')[0])}!</h1>
      <p class="subtitle">התשובות שלך נשלחו בהצלחה.<br>שתהיה לך שנה נפלאה ומוצלחת! 🎉</p>
    </div>
    <div class="card center">
      <div class="welcome-icon">🎮</div>
      <h2>רוצה להמשיך לאתגרי החשיבה?</h2>
      <p class="subtitle">
        חמישה משחקים קצרים — זיכרון, מהירות וחידות צורות.<br>
        <b>זה לא מבחן ואין ציונים</b> — פשוט כיף, וזה עוזר למורה להכיר אותך עוד קצת.<br>
        משך: כ-12 דקות. אפשר גם לדלג.
      </p>
      <a class="btn" href="/games/index.html?${qs}">קדימה, לאתגרים! ←</a>
    </div>`;
}

loadQuiz().catch(e => {
  app.innerHTML = `<div class="card center"><div class="error">שגיאה בטעינת השאלון: ${e.message}</div></div>`;
});
