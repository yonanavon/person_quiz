// חישוב פרופיל מתוך תשובות גולמיות.
// answers: { a1: 0..3, ..., b1: 0..3, ..., c1: 1..5, ..., d1: 1..5, ..., o1: "טקסט", ... }

const Q = require('./questions');

function scoreCommunication(answers) {
  const counts = { promoter: 0, driver: 0, analyst: 0, supporter: 0 };
  for (const q of Q.communication) {
    const idx = answers[q.id];
    if (idx == null || !q.options[idx]) continue;
    counts[q.options[idx].style]++;
  }
  const answered = Object.values(counts).reduce((a, b) => a + b, 0);
  const percent = {};
  // בלי תשובות אין אחוזים — חלוקה ב-1 הייתה מייצרת 0% מזויפים במקום "לא ידוע"
  for (const k of Object.keys(counts)) percent[k] = answered ? Math.round((counts[k] / answered) * 100) : 0;
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  // סגנון "ראשי" ללא תשובות הוא שרירותי (תמיד הראשון ברשימה) — עדיף null מפורש
  const enough = answered >= 3;
  return {
    counts, percent,
    primary: enough ? sorted[0] : null,
    secondary: enough ? sorted[1] : null,
    total: answered, answered,
    insufficient: !enough,
  };
}

function scoreMotivation(answers) {
  const counts = { people: 0, praise: 0, prizes: 0, prestige: 0, power: 0, projects: 0 };
  for (const q of Q.motivation) {
    const idx = answers[q.id];
    if (idx == null || !q.options[idx]) continue;
    counts[q.options[idx].p]++;
  }
  // כל P מופיע כאופציה 6 פעמים, לכן הציון המרבי לכל P הוא 6
  const percent = {};
  for (const k of Object.keys(counts)) percent[k] = Math.round((counts[k] / 6) * 100);
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const answered = Object.values(counts).reduce((a, b) => a + b, 0);
  const insufficient = answered < 3;
  return {
    counts, percent, ranked,
    top: insufficient ? [] : ranked.slice(0, 2),
    answered, insufficient,
  };
}

function scoreLearning(answers) {
  const byAxis = {};
  for (const q of Q.learning) {
    const raw = answers[q.id];
    if (raw == null || raw < 1 || raw > 5) continue;
    const val = q.reverse ? 6 - raw : raw;
    (byAxis[q.axis] = byAxis[q.axis] || []).push(val);
  }
  const axes = {};
  for (const axis of Object.keys(Q.LEARNING_AXES)) {
    const vals = byAxis[axis] || [];
    axes[axis] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }
  return { axes };
}

function flagFor(avg) {
  if (avg == null) return 'unknown';
  if (avg <= 2.4) return 'red';
  if (avg <= 3.4) return 'yellow';
  return 'green';
}

function scoreSel(answers) {
  const byScale = {};
  for (const q of Q.sel) {
    const raw = answers[q.id];
    if (raw == null || raw < 1 || raw > 5) continue;
    const val = q.reverse ? 6 - raw : raw;
    (byScale[q.scale] = byScale[q.scale] || []).push(val);
  }
  const scales = {};
  for (const scale of Object.keys(Q.SEL_SCALES)) {
    const vals = byScale[scale] || [];
    const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    scales[scale] = { avg, flag: flagFor(avg) };
  }
  // דגל אדום רק על סמך תשובות אמיתיות — 'unknown' אינו התראה
  const alerts = Object.entries(scales)
    .filter(([, v]) => v.flag === 'red')
    .map(([k]) => k);
  const unanswered = Object.entries(scales)
    .filter(([, v]) => v.flag === 'unknown')
    .map(([k]) => k);
  return { scales, alerts, unanswered };
}

function computeProfile(answers, durationSeconds) {
  const closed = [...Q.communication, ...Q.motivation, ...Q.learning, ...Q.sel];
  const answeredCount = closed.filter(q => answers[q.id] != null).length;
  const totalQuestions = closed.length;
  return {
    communication: scoreCommunication(answers),
    motivation: scoreMotivation(answers),
    learning: scoreLearning(answers),
    sel: scoreSel(answers),
    open: Object.fromEntries(Q.open.map(q => [q.id, (answers[q.id] || '').toString().slice(0, 2000)])),
    meta: {
      durationSeconds: durationSeconds || null,
      tooFast: durationSeconds != null && durationSeconds < 240,
      answeredCount,
      totalQuestions,
      completionRate: totalQuestions ? Math.round((answeredCount / totalQuestions) * 100) : 0,
      // מתחת ל-70% הפרופיל חלקי מדי כדי להסתמך עליו — מסומן למורה בממשק
      partial: answeredCount < totalQuestions * 0.7,
    },
  };
}

module.exports = { computeProfile };
