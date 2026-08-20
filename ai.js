// ניתוח AI מעמיק (היברידי) — פעיל רק כשמוגדר ANTHROPIC_API_KEY.

const Q = require('./questions');
const abilities = require('./abilities');

// ניתן לעקוף דרך משתנה סביבה אם רוצים מודל אחר
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function buildPrompt(studentName, className, profile, ability) {
  const comm = profile.communication;
  const motiv = profile.motivation;
  const lines = [];
  lines.push(`שם התלמיד: ${studentName} | כיתה: ${className} | בן, כיתה ז'-ח', מסגרת חינוך חרדית.`);
  lines.push('');
  lines.push('## תוצאות מדד סגנון תקשורת (Merrill & Reid):');
  for (const [k, v] of Object.entries(comm.percent)) lines.push(`- ${Q.COMM_STYLES[k]}: ${v}% (${comm.counts[k]}/12)`);
  if (comm.primary) {
    lines.push(`סגנון ראשי: ${Q.COMM_STYLES[comm.primary]}, משני: ${Q.COMM_STYLES[comm.secondary]}`);
  } else {
    lines.push('לא ניתן לקבוע סגנון — התלמיד ענה על מעט מדי שאלות במודול זה.');
  }
  lines.push('');
  lines.push('## מנועי מוטיבציה (6 ה-P של ריק לאבוי), לפי סדר עוצמה:');
  if (motiv.insufficient) lines.push('(מעט מדי תשובות במודול זה — הדירוג אינו אמין)');
  for (const p of motiv.ranked) lines.push(`- ${Q.MOTIVATORS[p]}: ${motiv.counts[p]}/6`);
  lines.push('');
  lines.push('## העדפות למידה (1 = הקצה הראשון בציר, 5 = הקצה השני):');
  for (const [axis, val] of Object.entries(profile.learning.axes)) {
    lines.push(`- ${Q.LEARNING_AXES[axis].label}: ${val ?? 'לא נענה'}`);
  }
  lines.push('');
  lines.push('## סולמות רגשיים-חברתיים (ממוצע 1-5, מתחת ל-2.5 = דגל אדום):');
  for (const [scale, v] of Object.entries(profile.sel.scales)) {
    lines.push(`- ${Q.SEL_SCALES[scale]}: ${v.avg ?? 'לא נענה'} (${v.flag})`);
  }
  lines.push('');
  const abilityText = abilities.abilitiesForPrompt(ability);
  if (abilityText) {
    lines.push(abilityText);
    lines.push('');
  }
  lines.push('## תשובות פתוחות (כלשונו):');
  for (const q of Q.open) {
    lines.push(`שאלה: ${q.text}`);
    lines.push(`תשובה: ${profile.open[q.id] || '(לא ענה)'}`);
  }
  if (profile.meta.tooFast) {
    lines.push('');
    lines.push('הערה: התלמיד מילא את השאלון במהירות חריגה (פחות מ-4 דקות) — ייתכן שמהימנות התשובות נמוכה.');
  }
  if (profile.meta.partial) {
    lines.push('');
    lines.push(`הערה חשובה: השאלון מולא חלקית בלבד (${profile.meta.completionRate}% מהשאלות). ` +
      'התייחס לנתונים בזהירות רבה, ציין במפורש שהתמונה חלקית, והימנע ממסקנות נחרצות.');
  }
  return lines.join('\n');
}

const SYSTEM = `אתה יועץ חינוכי מומחה המסייע למחנך בישיבה/תלמוד תורה לכיתות ז'-ח' להכיר את תלמידיו.
תקבל תוצאות שאלון אישיות של תלמיד. כתוב ניתוח אינטגרטיבי בעברית, מכבד ומעשי, המיועד לעיני המורה בלבד.

מבנה הניתוח:
1. **תמונה כוללת** — פסקה המחברת את כל הממדים לדמות אחת קוהרנטית (לא חזרה על המספרים, אלא מה הם מספרים יחד).
2. **נקודות חוזק** — במה התלמיד חזק וכיצד למנף זאת.
3. **נקודות לתשומת לב** — כולל שילובים מעניינים בין ממדים (למשל: תומך עם שייכות נמוכה, או משימתי עם עוצמה גבוהה). אם יש נתוני "אתגרי חשיבה", חפש שם את השילובים המשמעותיים ביותר — למשל מסוגלות עצמית נמוכה יחד עם חשיבה מופשטת גבוהה (תלמיד שלא יודע כמה הוא חכם), או פער בין יכולת גבוהה להישגים בפועל.
4. **המלצות מעשיות למורה** — 4-6 המלצות קונקרטיות: איך לגשת אליו, איך להניע אותו, איך להעיר לו, ומה לבדוק בהמשך.
5. **משפט מפתח** — משפט אחד שכדאי למורה לזכור על התלמיד הזה.

הנחיות: השתמש בדוגמאות המתאימות לעולם הישיבתי (חברותא, סדר, שיעור, תפילה) באופן טבעי. היזהר מקביעות נחרצות — זהו שאלון הכוונה, לא אבחון קליני. אם יש דגלים אדומים רגשיים-חברתיים, הדגש אותם ברגישות והמלץ על שיתוף גורם מקצועי במידת הצורך.

לגבי "אתגרי חשיבה" (אם קיימים): אלו אינם מבחני IQ ואין נורמות ארציות — האחוזון הוא ביחס לכיתה בלבד, ורועש כשמעט תלמידים שיחקו. אל תשתמש במונחים כמו "IQ", "מנת משכל" או "לקות למידה". דבר בשפה של חוזקות וחולשות יחסיות, והתייחס לתוצאות כאל סימני שאלה לבירור. אם סומנו דגלי מהימנות בתחנה — ציין זאת ואל תסיק ממנה מסקנות.`;

async function analyzeProfile(studentName, className, profile, ability = null) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(studentName, className, profile, ability) }],
  });
  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

module.exports = { aiEnabled, analyzeProfile };
