// בנק השאלות הקנוני — מקור האמת היחיד לשאלון ולניקוד.
// מבוסס על docs/assessment-design.md

const COMM_STYLES = {
  promoter: 'מקדם',
  driver: 'משימתי',
  analyst: 'מנתח',
  supporter: 'תומך',
};

const MOTIVATORS = {
  people: 'אנשים',
  praise: 'שבחים',
  prizes: 'פרסים',
  prestige: 'יוקרה',
  power: 'עוצמה',
  projects: 'פרויקטים',
};

const LEARNING_AXES = {
  social: { label: 'לבד ↔ יחד', low: 'מעדיף ללמוד לבד', high: 'מעדיף ללמוד יחד' },
  structure: { label: 'מובנות ↔ פתיחות', low: 'זקוק להוראות ברורות', high: 'אוהב משימות פתוחות' },
  pace: { label: 'זמן עיבוד ↔ קצב מהיר', low: 'זקוק לזמן חשיבה', high: 'מעדיף קצב מהיר' },
  movement: { label: 'ישיבה ↔ תנועה', low: 'מסתדר עם ישיבה ממושכת', high: 'זקוק לתנועה והפסקות' },
};

const SEL_SCALES = {
  efficacy: 'מסוגלות עצמית',
  grit: 'התמדה',
  regulation: 'ויסות רגשי',
  belonging: 'שייכות חברתית',
  helpSeeking: 'פנייה לעזרה',
};

// ---- מודול א': סגנון תקשורת (12 שאלות, ברירה כפויה) ----
const communication = [
  { id: 'a1', text: 'קיבלתם משימה קבוצתית להכין עלון לכבוד חג. מה הכי מתאים לך?', options: [
    { text: 'לזרוק רעיונות ולהלהיב את כולם', style: 'promoter' },
    { text: 'לחלק תפקידים ולדאוג שנסיים בזמן', style: 'driver' },
    { text: 'לבדוק שהכול מדויק ומסודר לפני שמגישים', style: 'analyst' },
    { text: 'לדאוג שכל אחד ירגיש שותף ואף אחד לא יישאר בחוץ', style: 'supporter' },
  ]},
  { id: 'a2', text: 'תלמיד חדש הגיע לכיתה. איך אתה מתנהג?', options: [
    { text: 'ניגש אליו ראשון, מספר לו על כולם ומצחיק אותו', style: 'promoter' },
    { text: 'מסביר לו בדיוק איך מתנהלים הדברים אצלנו', style: 'driver' },
    { text: 'מחכה קצת, מתבונן, ומתקרב כשמכירים יותר', style: 'analyst' },
    { text: 'מזמין אותו לשבת לידי ושואל אם הוא צריך עזרה', style: 'supporter' },
  ]},
  { id: 'a3', text: 'כשיש ויכוח בין חברים בהפסקה, אתה בדרך כלל...', options: [
    { text: 'באמצע העניינים, מביע דעה בקול', style: 'promoter' },
    { text: 'אומר מה לדעתי צריך לעשות וממשיך הלאה', style: 'driver' },
    { text: 'מקשיב לשני הצדדים ומנסה להבין מי צודק', style: 'analyst' },
    { text: 'מנסה להרגיע ולעשות שלום', style: 'supporter' },
  ]},
  { id: 'a4', text: 'המורה נתן עבודה לבחירה. מה תבחר?', options: [
    { text: 'משהו יצירתי שאפשר להציג מול הכיתה', style: 'promoter' },
    { text: 'משהו עם מטרה ברורה שאפשר לסיים מהר וטוב', style: 'driver' },
    { text: 'נושא מעניין שאפשר לחקור בו לעומק', style: 'analyst' },
    { text: 'עבודה בזוג עם חבר טוב', style: 'supporter' },
  ]},
  { id: 'a5', text: 'מתי לימוד בחברותא הכי טוב בשבילך?', options: [
    { text: 'כשמדברים, מתווכחים ומתלהבים מהלימוד', style: 'promoter' },
    { text: 'כשמתקדמים יפה בחומר ורואים הספק', style: 'driver' },
    { text: 'כשמעמיקים בכל פרט עד שהכול מובן', style: 'analyst' },
    { text: 'כשנעים ללמוד יחד ואף אחד לא לוחץ', style: 'supporter' },
  ]},
  { id: 'a6', text: 'קרה לך משהו מצחיק בדרך לתלמוד תורה. מה תעשה?', options: [
    { text: 'אספר לכולם בהתלהבות עם כל הפרטים', style: 'promoter' },
    { text: 'אספר בקצרה ואמשיך במה שעסקתי', style: 'driver' },
    { text: 'אספר רק אם מישהו ישאל', style: 'analyst' },
    { text: 'אספר לחבר הכי קרוב שלי', style: 'supporter' },
  ]},
  { id: 'a7', text: 'כשמחלקים תפקידים למסיבת סיום...', options: [
    { text: 'אני רוצה להנחות או להופיע', style: 'promoter' },
    { text: 'אני רוצה לארגן ולנהל את העניינים', style: 'driver' },
    { text: 'אני מעדיף להכין דברים מאחורי הקלעים, בצורה מסודרת', style: 'analyst' },
    { text: 'אעזור בכל מה שצריך, העיקר שיהיה שמח', style: 'supporter' },
  ]},
  { id: 'a8', text: 'קיבלת ציון נמוך ממה שציפית. מה התגובה הראשונה שלך?', options: [
    { text: 'מדבר על זה עם חברים, משחרר וממשיך', style: 'promoter' },
    { text: 'מחליט שבמבחן הבא אני משיג יותר', style: 'driver' },
    { text: 'עובר על המבחן לבדוק בדיוק איפה טעיתי', style: 'analyst' },
    { text: 'קצת נפגע; עוזר לי כשמישהו מעודד אותי', style: 'supporter' },
  ]},
  { id: 'a9', text: 'בסעודת שבת עם אורחים אתה בדרך כלל...', options: [
    { text: 'מספר סיפורים ואומר דברי תורה בשמחה', style: 'promoter' },
    { text: 'עוזר להגיש ודואג שהכול יתנהל כמו שצריך', style: 'driver' },
    { text: 'מקשיב יותר ממה שמדבר', style: 'analyst' },
    { text: 'משתדל שכולם ירגישו בנוח', style: 'supporter' },
  ]},
  { id: 'a10', text: 'כשאתה צריך להחליט משהו חשוב...', options: [
    { text: 'הולך עם הלב וההתלהבות', style: 'promoter' },
    { text: 'מחליט מהר ולא מסתכל אחורה', style: 'driver' },
    { text: 'שוקל את כל הצדדים לאט ובזהירות', style: 'analyst' },
    { text: 'מתייעץ עם אנשים שאני סומך עליהם', style: 'supporter' },
  ]},
  { id: 'a11', text: 'מה הכי מפריע לך בכיתה?', options: [
    { text: 'שיעורים משעממים בלי חיים', style: 'promoter' },
    { text: 'בזבוז זמן וחוסר סדר', style: 'driver' },
    { text: 'רעש ובלגן שמפריעים להתרכז', style: 'analyst' },
    { text: 'מריבות ומתחים בין ילדים', style: 'supporter' },
  ]},
  { id: 'a12', text: 'איך חברים היו מתארים אותך?', options: [
    { text: 'שמח, מלא אנרגיה, כיף להיות לידו', style: 'promoter' },
    { text: 'רציני, יודע מה הוא רוצה, מוביל', style: 'driver' },
    { text: 'חכם, שקט, יסודי', style: 'analyst' },
    { text: 'לב זהב, נאמן, תמיד מוכן לעזור', style: 'supporter' },
  ]},
];

// ---- מודול ב': מוטיבציה — 6 ה-P של לאבוי (9 שאלות, כל P מופיע 6 פעמים) ----
const motivation = [
  { id: 'b1', text: 'מתי אתה מרגיש הכי חשק ללמוד?', options: [
    { text: 'כשלומדים יחד בקבוצה או בחברותא טובה', p: 'people' },
    { text: 'כשהמורה מעודד אותי ואומר לי מילה טובה', p: 'praise' },
    { text: 'כשיש תחרות עם פרס בסוף', p: 'prizes' },
    { text: 'כשעושים משהו מעשי — בונים, יוצרים, מציגים', p: 'projects' },
  ]},
  { id: 'b2', text: 'איזה תפקיד היית הכי רוצה בהכנת מסיבת סיום?', options: [
    { text: 'להיות זה שמנחה ומופיע על הבמה', p: 'prestige' },
    { text: 'להיות האחראי שמחליט מה עושים', p: 'power' },
    { text: 'לעבוד בצוות יחד עם חברים', p: 'people' },
    { text: 'לבנות את התפאורה או להכין את המצגת', p: 'projects' },
  ]},
  { id: 'b3', text: 'סיימת בהצלחה משימה קשה. מה הכי משמח אותך?', options: [
    { text: 'שהמורה מספר להורים שלי כמה השקעתי', p: 'praise' },
    { text: 'לקבל פרס מוחשי', p: 'prizes' },
    { text: 'לקבל בזכות זה אחריות ותפקידים חדשים', p: 'power' },
    { text: 'שכל הכיתה יודעת שאני זה שהצליח', p: 'prestige' },
  ]},
  { id: 'b4', text: 'איזה שיעור הכי כיף לך?', options: [
    { text: 'שיעור שכולו עבודה בקבוצות', p: 'people' },
    { text: 'שיעור עם חידון נושא פרסים', p: 'prizes' },
    { text: 'שיעור שבו יוצרים ובונים משהו', p: 'projects' },
    { text: 'שיעור שבו אני בוחר מה ואיך ללמוד', p: 'power' },
  ]},
  { id: 'b5', text: 'מה גורם לך להתמיד בדבר קשה?', options: [
    { text: 'עידוד ומילים טובות לאורך הדרך', p: 'praise' },
    { text: 'הידיעה שבסוף יכירו בהצלחה שלי', p: 'prestige' },
    { text: 'חברים שעושים את זה יחד איתי', p: 'people' },
    { text: 'פרס מובטח בסוף הדרך', p: 'prizes' },
  ]},
  { id: 'b6', text: 'מה היית משנה בכיתה אם היית יכול?', options: [
    { text: 'שיתנו לתלמידים יותר אחריות והחלטות', p: 'power' },
    { text: 'שיהיו יותר פרויקטים ויצירה במקום דפי עבודה', p: 'projects' },
    { text: 'שהמורים יעודדו ויחמיאו יותר', p: 'praise' },
    { text: 'שיהיו יותר תפקידים מכובדים לתלמידים', p: 'prestige' },
  ]},
  { id: 'b7', text: 'קיבלת משימה משעממת. מה יעזור לך לסיים אותה?', options: [
    { text: 'משהו טוב שמחכה לי בסוף', p: 'prizes' },
    { text: 'לעשות אותה יחד עם חבר', p: 'people' },
    { text: 'שיתנו לי לעשות אותה בדרך שלי', p: 'power' },
    { text: 'למצוא דרך להפוך אותה למשהו מעניין ויצירתי', p: 'projects' },
  ]},
  { id: 'b8', text: 'דמיין את הרגע הכי טוב שלך השנה. מה קורה בו?', options: [
    { text: 'אני מקבל תעודה או תפקיד מול כל בית הספר', p: 'prestige' },
    { text: 'הרב אומר לי בשקט: "אני גאה בך"', p: 'praise' },
    { text: 'אני מסיים משהו גדול שבניתי לאורך זמן', p: 'projects' },
    { text: 'אני מוקף חברים ושמח יחד איתם', p: 'people' },
  ]},
  { id: 'b9', text: 'מה הכי מדרבן אותך לקראת מבחן חשוב?', options: [
    { text: 'להוכיח שאני מסוגל בכוחות עצמי', p: 'power' },
    { text: 'הפרס שהובטח למצליחים', p: 'prizes' },
    { text: 'להיות בין המצטיינים ששמם עולה', p: 'prestige' },
    { text: 'לדעת שהמורה ישים לב להשקעה שלי ויעודד', p: 'praise' },
  ]},
];

// ---- מודול ג': העדפות למידה (8 שאלות ליקרט 1-5) ----
// reverse=true פירושו שציון גבוה מצביע על הקצה הנמוך של הציר
const learning = [
  { id: 'c1', text: 'אני מתרכז הכי טוב כשאני לומד לבד ובשקט', axis: 'social', reverse: true },
  { id: 'c2', text: 'עבודה עם חברים עוזרת לי להבין טוב יותר', axis: 'social', reverse: false },
  { id: 'c3', text: 'חשוב לי לדעת בדיוק מה צריך לעשות, שלב אחרי שלב', axis: 'structure', reverse: true },
  { id: 'c4', text: 'אני נהנה ממשימות פתוחות שבהן אני מחליט לבד איך לבצע', axis: 'structure', reverse: false },
  { id: 'c5', text: 'אני צריך זמן לחשוב לפני שאני עונה בכיתה', axis: 'pace', reverse: true },
  { id: 'c6', text: 'כשמסבירים לאט מדי אני מאבד סבלנות', axis: 'pace', reverse: false },
  { id: 'c7', text: 'קשה לי לשבת זמן ארוך בלי לזוז או לצאת להפסקה', axis: 'movement', reverse: false },
  { id: 'c8', text: 'הפסקות קצרות באמצע הלימוד מחזירות לי את הריכוז', axis: 'movement', reverse: false },
];

// ---- מודול ד': פן רגשי-חברתי (11 שאלות ליקרט 1-5) ----
const sel = [
  { id: 'd1', text: 'כשאני מקבל משימה קשה, אני מאמין שאצליח בה', scale: 'efficacy', reverse: false },
  { id: 'd2', text: 'גם כשהחומר קשה, אני יכול להצליח אם אתאמץ', scale: 'efficacy', reverse: false },
  { id: 'd3', text: 'כשאני נכשל במשהו, אני מנסה שוב בדרך אחרת', scale: 'efficacy', reverse: false },
  { id: 'd4', text: 'אני מסיים דברים שהתחלתי, גם כשהם נהיים קשים', scale: 'grit', reverse: false },
  { id: 'd5', text: 'במשימה ארוכה אני מתייאש מהר', scale: 'grit', reverse: true },
  { id: 'd6', text: 'כשאני כועס או נעלב, אני מצליח להירגע די מהר', scale: 'regulation', reverse: false },
  { id: 'd7', text: 'כשמשהו מלחיץ אותי, קשה לי להמשיך כרגיל', scale: 'regulation', reverse: true },
  { id: 'd8', text: 'אני מרגיש שייך ורצוי בין הילדים בכיתה', scale: 'belonging', reverse: false },
  { id: 'd9', text: 'יש לי חברים שאני יכול לסמוך עליהם באמת', scale: 'belonging', reverse: false },
  { id: 'd10', text: 'כשקשה לי בלימודים, נוח לי לבקש עזרה מהמורה', scale: 'helpSeeking', reverse: false },
  { id: 'd11', text: 'אני מעדיף להסתדר לבד גם כשאני ממש תקוע', scale: 'helpSeeking', reverse: true },
];

// ---- שאלות פתוחות ----
const open = [
  { id: 'o1', text: 'משהו אחד שחשוב לך שהמורה יידע עליך...' },
  { id: 'o2', text: 'ספר בקצרה על פעם שהרגשת הצלחה אמיתית.' },
  { id: 'o3', text: 'במה אתה הכי טוב, ומה אתה הכי אוהב לעשות בזמן הפנוי?' },
];

const LIKERT_LABELS = ['בכלל לא מתאים לי', 'פחות מתאים לי', 'ככה-ככה', 'די מתאים לי', 'מאוד מתאים לי'];

module.exports = {
  COMM_STYLES, MOTIVATORS, LEARNING_AXES, SEL_SCALES, LIKERT_LABELS,
  communication, motivation, learning, sel, open,
};
