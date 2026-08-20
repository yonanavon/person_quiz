// ממשק המורה — התחברות, רשימת תלמידים, פרופיל מלא, תצוגת כיתה וניתוח AI.

const app = document.getElementById('app');
let aiEnabled = false;

// כל טקסט שמקורו בתלמיד (שם, תשובה פתוחה) או במורה (שם כיתה, קוד) חייב לעבור כאן
// לפני הזרקה ל-innerHTML — אחרת תלמיד שכותב תגית HTML כשם מריץ קוד בדפדפן המורה.
function esc(v) {
  return (v ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה');
  return data;
}

async function boot() {
  const me = await api('/api/admin/me');
  aiEnabled = me.aiEnabled;
  if (me.loggedIn) renderDashboard();
  else renderLogin();
}

function renderLogin() {
  app.innerHTML = `
    <div class="card" style="max-width:420px;margin:60px auto;">
      <h1>ממשק מורה</h1>
      <p class="subtitle">כניסה לצפייה בתוצאות השאלון</p>
      <label>סיסמה</label>
      <input type="password" id="pw">
      <div class="error" id="err"></div>
      <button class="btn" id="login">כניסה</button>
    </div>`;
  const submit = async () => {
    try {
      await api('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('pw').value }),
      });
      renderDashboard();
    } catch (e) {
      document.getElementById('err').textContent = e.message;
    }
  };
  document.getElementById('login').onclick = submit;
  document.getElementById('pw').onkeydown = e => { if (e.key === 'Enter') submit(); };
}

async function renderDashboard() {
  const [classes, submissions] = await Promise.all([
    api('/api/admin/classes'),
    api('/api/admin/submissions'),
  ]);

  const classRows = classes.map(c => `
    <tr>
      <td><b>${esc(c.name)}</b></td>
      <td><span class="tag tag-blue">${esc(c.code)}</span></td>
      <td>${esc(c.submissions)}</td>
      <td><button class="btn-ghost btn" data-overview="${esc(c.id)}" data-name="${esc(c.name)}">תמונת כיתה</button></td>
    </tr>`).join('');

  const subRows = submissions.map(s => `
    <tr class="clickable" data-id="${esc(s.id)}">
      <td><b>${esc(s.studentName)}</b>${s.abandoned ? ` <span class="tag tag-red" title="התלמיד לא סיים ולא שלח — נשמר אוטומטית">⏸ לא הושלם</span>` : ''}${s.tooFast ? ' <span class="tag tag-amber" title="מילוי מהיר מדי — מהימנות מוטלת בספק">⚡ מהיר</span>' : ''}${s.partial && !s.abandoned ? ` <span class="tag tag-amber" title="שאלון חלקי — ${esc(s.completionRate)}% מהשאלות">◐ חלקי</span>` : ''}</td>
      <td>${esc(s.className)}</td>
      <td><span class="tag tag-blue">${esc(s.primaryStyle)}</span></td>
      <td><span class="tag tag-green">${esc(s.topMotivator)}</span></td>
      <td>${s.alerts.length ? s.alerts.map(a => `<span class="tag tag-red">${esc(a)}</span>`).join(' ') : '—'}</td>
      <td>${esc(new Date(s.createdAt).toLocaleDateString('he-IL'))}</td>
    </tr>`).join('');

  app.innerHTML = `
    <div class="topbar">
      <h1>ממשק מורה</h1>
      <div>
        <a class="btn-ghost btn" href="/api/admin/export.csv">⬇ ייצוא CSV</a>
        <button class="btn-ghost btn" id="logout">יציאה</button>
      </div>
    </div>

    <div class="card">
      <h2>כיתות</h2>
      <table>
        <thead><tr><th>כיתה</th><th>קוד לתלמידים</th><th>מילאו</th><th></th></tr></thead>
        <tbody>${classRows || '<tr><td colspan="4">אין עדיין כיתות</td></tr>'}</tbody>
      </table>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1;min-width:140px;"><label>שם כיתה</label><input type="text" id="clsName" style="margin-bottom:0;" placeholder='למשל: ז1'></div>
        <div style="flex:1;min-width:140px;"><label>קוד לתלמידים</label><input type="text" id="clsCode" style="margin-bottom:0;" placeholder="למשל: 7134"></div>
        <button class="btn" id="addClass">+ הוספת כיתה</button>
      </div>
      <div class="error" id="clsErr"></div>
    </div>

    <div class="card">
      <h2>תלמידים (${submissions.length})</h2>
      <p class="subtitle">לחץ על שורה לצפייה בפרופיל המלא</p>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>שם</th><th>כיתה</th><th>סגנון</th><th>מנוע מוטיבציה</th><th>דגלים</th><th>תאריך</th></tr></thead>
        <tbody>${subRows || '<tr><td colspan="6">אין עדיין תוצאות</td></tr>'}</tbody>
      </table>
      </div>
    </div>
    <div id="overviewBox"></div>`;

  document.getElementById('logout').onclick = async () => {
    await api('/api/admin/logout', { method: 'POST' });
    renderLogin();
  };
  document.getElementById('addClass').onclick = async () => {
    const err = document.getElementById('clsErr');
    err.textContent = '';
    try {
      await api('/api/admin/classes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('clsName').value,
          code: document.getElementById('clsCode').value,
        }),
      });
      renderDashboard();
    } catch (e) { err.textContent = e.message; }
  };
  app.querySelectorAll('tr.clickable').forEach(tr => {
    tr.onclick = () => renderProfile(tr.dataset.id);
  });
  app.querySelectorAll('[data-overview]').forEach(btn => {
    btn.onclick = () => renderOverview(btn.dataset.overview, btn.dataset.name);
  });
}

async function renderOverview(classId, className) {
  const o = await api('/api/admin/class-overview/' + classId);
  const box = document.getElementById('overviewBox');
  if (!o.count) {
    box.innerHTML = `<div class="card"><h2>תמונת כיתה — ${esc(className)}</h2>
      <p class="subtitle">${o.abandoned
        ? `אין עדיין שאלונים שהושלמו בכיתה זו. ${esc(o.abandoned)} תלמידים התחילו ולא סיימו — התשובות שלהם נשמרו ומופיעות ברשימת התלמידים.`
        : 'אין עדיין תוצאות בכיתה זו.'}</p></div>`;
    box.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const bars = (dist, labels, cls) => Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div class="bar-row">
        <div class="bar-label">${esc(labels[k])}</div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.round(v / o.count * 100)}%"></div></div>
        <div class="bar-val">${esc(v)}</div>
      </div>`).join('');
  box.innerHTML = `
    <div class="card">
      <h2>תמונת כיתה — ${esc(className)} (${esc(o.count)} תלמידים)</h2>
      <h3 style="margin:14px 0 8px;">התפלגות סגנונות תקשורת (ראשי)</h3>
      ${bars(o.styleDist, o.labels.comm, '')}
      <h3 style="margin:18px 0 8px;">התפלגות מנועי מוטיבציה (מוביל)</h3>
      ${bars(o.motivDist, o.labels.motiv, 'accent')}
      <p class="subtitle" style="margin-top:14px;">${o.redFlags ? `🔴 ${esc(o.redFlags)} תלמידים עם דגל אדום רגשי-חברתי — מומלץ לעיין בפרופילים שלהם.` : '🟢 אין דגלים אדומים בכיתה.'}
      ${o.partial ? `<br>◐ ${esc(o.partial)} שאלונים חלקיים — אינם נכללים בהתפלגויות שלמעלה.` : ''}
      ${o.abandoned ? `<br>⏸ ${esc(o.abandoned)} תלמידים התחילו ולא סיימו — התשובות שלהם נשמרו ומופיעות ברשימה.` : ''}</p>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth' });
}

// פרופיל יכולות מ"אתגרי חשיבה".
// מוצג במפורש כפרופיל יחסי — בלי ציוני IQ ובלי ניסוח אבחנתי.
function renderAbilities(ability, minPeers) {
  if (!ability || !ability.playedCount) {
    return `
    <div class="card">
      <h2>🎮 פרופיל יכולות</h2>
      <p class="subtitle">התלמיד עדיין לא השתתף באתגרי החשיבה.
      אפשר לשלוח אותו לכתובת <code>/games/</code> עם השם וקוד הכיתה.</p>
    </div>`;
  }

  const rows = ability.stations.map(s => {
    if (!s.played) {
      return `
      <div class="ability-row not-played">
        <div class="ability-head">
          <span class="ability-name">${esc(s.emoji)} ${esc(s.name)}</span>
          <span class="ability-score">לא שוחק</span>
        </div>
        <div class="ability-measures">${esc(s.measures)}</div>
      </div>`;
    }
    const pctBar = s.percentile == null ? '' : `
      <div class="bar-track" style="margin-top:6px;">
        <div class="bar-fill ${s.band === 'low' ? 'low' : s.band === 'high' ? 'high' : ''}"
             style="width:${Number(s.percentile) || 0}%"></div>
      </div>`;
    return `
      <div class="ability-row">
        <div class="ability-head">
          <span class="ability-name">${esc(s.emoji)} ${esc(s.name)}</span>
          <span class="ability-score">${esc(s.rawLabel)}</span>
        </div>
        <div class="ability-measures">${esc(s.measures)}</div>
        ${pctBar}
        ${s.percentile != null
          ? `<div class="ability-pct">אחוזון כיתתי ${esc(s.percentile)} — ${esc(s.bandText)}</div>`
          : `<div class="ability-pct muted">אין עדיין מספיק תלמידים בכיתה (${esc(minPeers)}+) לחישוב אחוזון</div>`}
        <div class="ability-note">💡 ${esc(s.teacherNote)}</div>
        ${s.reliabilityNote
          ? `<div class="ability-flag">⚠ מהימנות: ${esc(s.reliabilityNote)} — יש להתייחס לתוצאה בזהירות</div>`
          : ''}
      </div>`;
  }).join('');

  const summary = ability.strength && ability.weakness
    ? `<div class="interp"><b>פרופיל יחסי:</b> חזק יותר ב"${esc(ability.strength.name)}",
       חלש יותר ב"${esc(ability.weakness.name)}". זהו הבדל בתוך התלמיד עצמו — לא ציון מוחלט.</div>`
    : '';

  return `
    <div class="card">
      <h2>🎮 פרופיל יכולות</h2>
      <p class="subtitle">${esc(ability.playedCount)}/${esc(ability.totalStations)} תחנות הושלמו</p>
      ${rows}
      ${summary}
      <div class="flag flag-yellow" style="margin-top:14px;">
        <div class="dot"></div>
        <div><b>חשוב לקריאה נכונה:</b> אלו אינם מבחני IQ ואין להם נורמות ארציות.
        האחוזון מחושב מול הכיתה בלבד ומשתפר ככל שיותר תלמידים משתתפים.
        התוצאות הן סימני שאלה להמשך בירור — לא אבחנה ולא תיוג.</div>
      </div>
    </div>`;
}

async function renderProfile(id) {
  const d = await api('/api/admin/submissions/' + id);
  const p = d.profile;
  const L = d.labels;
  const I = d.interpretations;

  const commBars = Object.entries(p.communication.percent)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div class="bar-row">
        <div class="bar-label">${esc(L.comm[k])}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Number(v) || 0}%"></div></div>
        <div class="bar-val">${esc(v)}%</div>
      </div>`).join('');

  const primary = I.COMM[p.communication.primary] || null;
  const secondary = I.COMM[p.communication.secondary] || null;

  const motivBars = p.motivation.ranked.map(k => `
    <div class="bar-row">
      <div class="bar-label">${esc(L.motiv[k])}</div>
      <div class="bar-track"><div class="bar-fill accent" style="width:${Number(p.motivation.percent[k]) || 0}%"></div></div>
      <div class="bar-val">${esc(p.motivation.counts[k])}/6</div>
    </div>`).join('');

  const motivTips = p.motivation.top.map(k => `
    <div class="interp"><b>${esc(I.MOTIV[k].name)}</b> — ${esc(I.MOTIV[k].desc)}<br>💡 ${esc(I.MOTIV[k].strategies)}</div>`).join('');

  const axes = Object.entries(p.learning.axes).map(([axis, val]) => {
    const meta = L.axes[axis];
    let tip = '';
    if (val != null) {
      const side = val <= 2.4 ? 'low' : val >= 3.6 ? 'high' : 'mid';
      tip = I.LEARNING_TIPS[axis][side];
    }
    // ציר RTL: הקצה ה"נמוך" מימין
    const pctFromRight = val == null ? 50 : ((val - 1) / 4) * 100;
    return `
      <div class="axis-row">
        <div class="axis-ends"><span>${esc(meta.low)}</span><span>${esc(meta.high)}</span></div>
        <div class="axis-track"><div class="axis-dot" style="right:${Number(pctFromRight) || 0}%"></div></div>
        <div style="font-size:.88rem;color:var(--muted);margin-top:6px;">${esc(tip)}</div>
      </div>`;
  }).join('');

  const selRows = Object.entries(p.sel.scales).map(([scale, v]) => {
    const meta = I.SEL_TEXT[scale];
    // 'לא נענה' אינו ציון בינוני — מוצג אפור ובלי טקסט פרשני, כדי לא להטעות את המורה
    if (v.flag === 'unknown') {
      return `
      <div class="flag flag-unknown">
        <div class="dot"></div>
        <div><b>${esc(meta.name)}</b> — <span style="color:var(--muted);">לא נענה</span><br>
        <span style="font-size:.9rem;color:var(--muted);">התלמיד לא ענה על שאלות הסולם הזה — אין נתון להצגה.</span></div>
      </div>`;
    }
    const text = v.flag === 'green' ? meta.ok : meta.low;
    return `
      <div class="flag flag-${esc(v.flag)}">
        <div class="dot"></div>
        <div><b>${esc(meta.name)}</b> — ממוצע ${esc(v.avg)}<br><span style="font-size:.9rem;">${esc(text)}</span></div>
      </div>`;
  }).join('');

  const openAnswers = d.openQuestions.map(q => `
    <div class="open-answer">
      <div class="q">${esc(q.text)}</div>
      <div>${esc(p.open[q.id] || '(לא ענה)')}</div>
    </div>`).join('');

  const aiSection = d.aiAnalysis
    ? `<div class="ai-box">${esc(d.aiAnalysis).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</div>
       <p class="subtitle" style="margin-top:8px;">נותח ב-${esc(new Date(d.aiAnalyzedAt).toLocaleString('he-IL'))}
       <button class="btn-ghost btn" id="reanalyze">🔄 ניתוח מחדש</button></p>`
    : aiEnabled
      ? `<p class="subtitle">ניתוח אינטגרטיבי מעמיק של כל הממדים יחד, עם המלצות פרטניות.</p>
         <button class="btn" id="analyze">✨ הפעל ניתוח AI מעמיק</button><div class="error" id="aiErr"></div>`
      : `<p class="subtitle">ניתוח AI אינו מוגדר. כדי להפעיל — הגדר משתנה סביבה ANTHROPIC_API_KEY.</p>`;

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-ghost btn" id="back">→ חזרה לרשימה</button>
      <button class="btn-ghost btn" id="del" style="color:var(--red);">🗑 מחיקה</button>
    </div>
    <div class="card">
      <h1>${esc(d.studentName)}</h1>
      <p class="subtitle">כיתה ${esc(d.className)} · מולא ב-${esc(new Date(d.createdAt).toLocaleString('he-IL'))}
        · משך: ${d.durationSeconds ? esc(Math.round(d.durationSeconds / 60)) + ' דק\'' : '—'}
        ${p.meta.tooFast ? ' · <span class="tag tag-amber">⚡ מילוי מהיר מדי — מהימנות בספק</span>' : ''}
        · ענה על ${esc(p.meta.answeredCount)}/${esc(p.meta.totalQuestions)} שאלות</p>
      ${d.abandoned ? `<div class="flag flag-red" style="margin-top:10px;">
        <div class="dot"></div>
        <div><b>השאלון לא הושלם</b> — התלמיד ענה על ${esc(p.meta.completionRate)}% מהשאלות ולא לחץ "שליחה".
        התשובות נשמרו אוטומטית כדי שלא ילכו לאיבוד${d.updatedAt ? ` (עדכון אחרון: ${esc(new Date(d.updatedAt).toLocaleString('he-IL'))})` : ''}.
        הפרופיל שלהלן חלקי — כדאי לבקש מהתלמיד להשלים את השאלון.</div>
      </div>`
      : p.meta.partial ? `<div class="flag flag-yellow" style="margin-top:10px;">
        <div class="dot"></div>
        <div><b>שאלון חלקי</b> — התלמיד ענה על ${esc(p.meta.completionRate)}% מהשאלות בלבד.
        הפרופיל שלהלן מבוסס על נתונים חסרים; מומלץ לבקש ממנו להשלים.</div>
      </div>` : ''}
    </div>

    <div class="card">
      <h2>🗣 סגנון תקשורת</h2>
      ${commBars}
      ${primary ? `
      <div class="interp">
        <b>סגנון ראשי — ${esc(primary.name)}:</b> ${esc(primary.traits)}<br><br>
        <b>איך לגשת אליו:</b> ${esc(primary.approach)}<br>
        <b>איך להניע אותו:</b> ${esc(primary.motivate)}<br>
        <b>ממה להיזהר:</b> ${esc(primary.caution)}<br>
        <b>משמעת וחינוך:</b> ${esc(primary.discipline)}
      </div>` : `
      <div class="interp">התלמיד ענה על מעט מדי שאלות במודול זה (${esc(p.communication.answered)}) — לא ניתן לקבוע סגנון.</div>`}
      ${secondary ? `<div class="interp"><b>סגנון משני — ${esc(secondary.name)}:</b> ${esc(secondary.traits)}</div>` : ''}
    </div>

    <div class="card">
      <h2>🔥 מנועי מוטיבציה (לפי ריק לאבוי)</h2>
      ${motivBars}
      <h3 style="margin:14px 0 4px;">אסטרטגיות לשני המנועים המובילים:</h3>
      ${motivTips}
    </div>

    <div class="card">
      <h2>📖 העדפות למידה</h2>
      ${axes}
    </div>

    <div class="card">
      <h2>💙 פן רגשי-חברתי</h2>
      ${selRows}
      <p class="subtitle" style="margin-top:10px;">מבוסס על דיווח עצמי — ציון נמוך הוא איתות לבירור, לא אבחנה.</p>
    </div>

    <div class="card">
      <h2>✍️ במילים שלו</h2>
      ${openAnswers}
    </div>

    ${renderAbilities(d.ability, d.minPeers)}

    <div class="card">
      <h2>✨ ניתוח AI מעמיק</h2>
      <div id="aiSection">${aiSection}</div>
    </div>`;

  document.getElementById('back').onclick = renderDashboard;
  document.getElementById('del').onclick = async () => {
    if (!confirm(`למחוק את התוצאות של ${d.studentName}? פעולה זו אינה הפיכה.`)) return;
    await api('/api/admin/submissions/' + id, { method: 'DELETE' });
    renderDashboard();
  };

  const runAnalysis = async (btnId) => {
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> מנתח... (עד דקה)';
    try {
      await api('/api/admin/analyze/' + id, { method: 'POST' });
      renderProfile(id);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '✨ הפעל ניתוח AI מעמיק';
      const errEl = document.getElementById('aiErr');
      if (errEl) errEl.textContent = e.message;
    }
  };
  const analyzeBtn = document.getElementById('analyze');
  if (analyzeBtn) analyzeBtn.onclick = () => runAnalysis('analyze');
  const reBtn = document.getElementById('reanalyze');
  if (reBtn) reBtn.onclick = () => runAnalysis('reanalyze');
  window.scrollTo(0, 0);
}

boot().catch(e => {
  app.innerHTML = `<div class="card center"><div class="error">${e.message}</div></div>`;
});
