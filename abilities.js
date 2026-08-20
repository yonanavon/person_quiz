// פרופיל יכולות מתוך תחנות "אתגרי חשיבה".
//
// עיקרון מנחה (מתוך docs/cognitive-games-plan.md): אין לנו נורמות ארציות ולכן
// אין כאן ציוני IQ. מה שכן: פרופיל *יחסי* — חוזקות וחולשות של התלמיד ביחס לעצמו
// וביחס לכיתה (אחוזון פנימי). כל ניסוח כאן הוא סימן שאלה למורה, לא אבחנה.

const STATION_META = {
  'matrix': {
    name: 'חידות צורות',
    emoji: '🧩',
    measures: 'חשיבה מופשטת (אינטליגנציה נוזלית)',
    teacherNote: 'הפער בין היכולת כאן להישגים בפועל הוא הסימן החשוב: תלמיד חזק כאן וחלש בציונים — שווה בירור.',
  },
  'corsi': {
    name: 'זיכרון הקוביות',
    emoji: '🔵',
    measures: 'זיכרון עבודה חזותי-מרחבי',
    teacherNote: 'משפיע על כמה הוראות אפשר לתת בבת אחת, ועל העתקה מהלוח.',
  },
  'digit-span': {
    name: 'מספרים הפוכים',
    emoji: '🔢',
    measures: 'זיכרון עבודה מילולי',
    teacherNote: 'היכולת להחזיק שלבים בראש — קריטי בגמרא ובחשבון.',
  },
  'symbol-speed': {
    name: 'מהיר וממוקד',
    emoji: '⚡',
    measures: 'מהירות עיבוד',
    teacherNote: 'תלמיד איטי אך מדויק אינו "חלש" — ייתכן שהוא רק זקוק ליותר זמן במבחנים.',
  },
  'go-no-go': {
    name: 'עצור וסע',
    emoji: '🚦',
    measures: 'עכבה (אימפולסיביות) וקשב מתמשך',
    teacherNote: 'ציון נמוך אינו ADHD — זהו סימן שאלה שמצדיק תשומת לב, ולא תיוג.',
  },
};

const STATION_ORDER = ['matrix', 'corsi', 'digit-span', 'symbol-speed', 'go-no-go'];

// ציון גולמי אחיד לכל תחנה ("גבוה = טוב יותר"), לצורך השוואה יחסית בלבד.
// אינו ציון תקני ואין לו משמעות מוחלטת — רק לדירוג מול הכיתה ומול שאר התחנות.
function rawScore(station, m) {
  if (!m) return null;
  switch (station) {
    case 'corsi':
      return typeof m.span === 'number' ? m.span : null;
    case 'digit-span':
      return typeof m.backwardSpan === 'number' ? m.backwardSpan : null;
    case 'symbol-speed':
      // כמות נכונים לדקה — מאזן מהירות מול דיוק
      return typeof m.correctPerMinute === 'number' ? m.correctPerMinute : null;
    case 'matrix':
      return typeof m.correct === 'number' ? m.correct : null;
    case 'go-no-go': {
      // שילוב עכבה (שגיאות נציה) וקשב (שגיאות השמטה) לציון דיוק אחד
      const go = Number(m.goTrials) || 0;
      const nogo = Number(m.noGoTrials) || 0;
      if (!go && !nogo) return null;
      const comm = Number(m.commissionErrors) || 0;
      const omis = Number(m.omissionErrors) || 0;
      const total = go + nogo;
      return Math.round(((total - comm - omis) / total) * 1000) / 10; // אחוז דיוק
    }
    default:
      return null;
  }
}

// תיאור קריא של התוצאה הגולמית, כפי שיוצג למורה
function rawLabel(station, m) {
  if (!m) return '—';
  switch (station) {
    case 'corsi':
      return `רצף ${m.span ?? '—'} קוביות`;
    case 'digit-span':
      return `${m.backwardSpan ?? '—'} ספרות לאחור`;
    case 'symbol-speed':
      return `${m.correctPerMinute ?? '—'} נכונים לדקה (דיוק ${Math.round((m.accuracy ?? 0) * 100)}%)`;
    case 'matrix':
      return `${m.correct ?? '—'}/${m.items ?? '—'} פריטים`;
    case 'go-no-go': {
      const acc = rawScore(station, m);
      return acc == null ? '—'
        : `דיוק ${acc}% (${m.commissionErrors ?? 0} לחיצות מיותרות, ${m.omissionErrors ?? 0} החמצות)`;
    }
    default:
      return '—';
  }
}

// אחוזון פנימי בכיתה. עם מעט תלמידים זה רועש מאוד, ולכן מוחזר null מתחת ל-5.
const MIN_PEERS_FOR_PERCENTILE = 5;

function percentile(value, peers) {
  if (value == null || peers.length < MIN_PEERS_FOR_PERCENTILE) return null;
  const below = peers.filter(v => v < value).length;
  const equal = peers.filter(v => v === value).length;
  return Math.round(((below + equal / 2) / peers.length) * 100);
}

function bandOf(pct) {
  if (pct == null) return null;
  if (pct >= 75) return 'high';
  if (pct <= 25) return 'low';
  return 'mid';
}

const BAND_TEXT = {
  high: 'חזק יחסית לכיתה',
  mid: 'בטווח הממוצע של הכיתה',
  low: 'נמוך יחסית לכיתה',
};

// דגלי מהימנות שהתחנות עצמן מסמנות
function reliabilityNote(reliability) {
  if (!reliability) return null;
  const flags = Array.isArray(reliability.flags) ? reliability.flags : [];
  if (!flags.length && reliability.practicePassed !== false) return null;
  const notes = [];
  if (reliability.practicePassed === false) notes.push('לא עבר את שלב התרגול');
  if (flags.includes('practice-repeated')) notes.push('חזר על התרגול');
  if (flags.includes('too-fast') || flags.includes('random-pattern')) notes.push('דפוס תשובות שנראה אקראי');
  if (flags.includes('left-page') || flags.includes('abandoned')) notes.push('יצא מהדף באמצע');
  const rest = flags.length - notes.length;
  if (!notes.length && rest > 0) notes.push('סומנו דגלי מהימנות');
  return notes.length ? notes.join(', ') : null;
}

/**
 * בונה פרופיל יכולות לתלמיד יחיד.
 * @param {Array} studentRows שורות game_results של התלמיד
 * @param {Object} peerScoresByStation { station: number[] } ציונים גולמיים של שאר הכיתה
 */
function buildAbilityProfile(studentRows, peerScoresByStation = {}) {
  // תחנה שנוגנה יותר מפעם אחת — לוקחים את הניסיון האחרון
  const latest = new Map();
  for (const r of studentRows) {
    const prev = latest.get(r.station);
    if (!prev || new Date(r.createdAt) > new Date(prev.createdAt)) latest.set(r.station, r);
  }

  const stations = [];
  for (const key of STATION_ORDER) {
    const meta = STATION_META[key];
    const row = latest.get(key);
    if (!row) {
      stations.push({ station: key, ...meta, played: false });
      continue;
    }
    const score = rawScore(key, row.metrics);
    const pct = percentile(score, peerScoresByStation[key] || []);
    stations.push({
      station: key, ...meta,
      played: true,
      raw: score,
      rawLabel: rawLabel(key, row.metrics),
      percentile: pct,
      band: bandOf(pct),
      bandText: pct == null ? null : BAND_TEXT[bandOf(pct)],
      reliabilityNote: reliabilityNote(row.reliability),
      durationSeconds: row.durationSeconds,
      createdAt: row.createdAt,
    });
  }

  const playedCount = stations.filter(s => s.played).length;
  const ranked = stations.filter(s => s.played && s.percentile != null)
    .sort((a, b) => b.percentile - a.percentile);

  // "חוזק/חולשה יחסית" נאמר רק כשיש פער אמיתי בין הגבוה לנמוך
  let strength = null, weakness = null;
  if (ranked.length >= 2 && ranked[0].percentile - ranked[ranked.length - 1].percentile >= 25) {
    strength = ranked[0];
    weakness = ranked[ranked.length - 1];
  }

  return {
    stations,
    playedCount,
    totalStations: STATION_ORDER.length,
    complete: playedCount === STATION_ORDER.length,
    strength: strength ? { station: strength.station, name: strength.name, percentile: strength.percentile } : null,
    weakness: weakness ? { station: weakness.station, name: weakness.name, percentile: weakness.percentile } : null,
    hasPercentiles: stations.some(s => s.percentile != null),
  };
}

// טקסט לניתוח ה-AI. מדגיש במפורש שאין כאן ציוני תקן.
function abilitiesForPrompt(profile) {
  if (!profile || !profile.playedCount) return null;
  const lines = [];
  lines.push(`## אתגרי חשיבה (${profile.playedCount}/${profile.totalStations} תחנות)`);
  lines.push('חשוב: אלו אינם ציוני IQ ואין נורמות ארציות. האחוזון הוא ביחס לכיתה בלבד,');
  lines.push('והוא רועש כשמעט תלמידים שיחקו. התייחס לזה כאל סימני שאלה, לא כאבחנה.');
  for (const s of profile.stations) {
    if (!s.played) { lines.push(`- ${s.name} (${s.measures}): לא שוחק`); continue; }
    const parts = [`${s.rawLabel}`];
    if (s.percentile != null) parts.push(`אחוזון כיתתי ${s.percentile} — ${s.bandText}`);
    if (s.reliabilityNote) parts.push(`מהימנות: ${s.reliabilityNote}`);
    lines.push(`- ${s.name} (${s.measures}): ${parts.join(' | ')}`);
  }
  if (profile.strength && profile.weakness) {
    lines.push(`פרופיל יחסי: חזק יותר ב"${profile.strength.name}", חלש יותר ב"${profile.weakness.name}".`);
  }
  return lines.join('\n');
}

module.exports = {
  STATION_META, STATION_ORDER,
  rawScore, rawLabel, buildAbilityProfile, abilitiesForPrompt,
  MIN_PEERS_FOR_PERCENTILE,
};
