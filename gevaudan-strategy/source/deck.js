const pptxgen = require("pptxgenjs");
const React = require("react");
const RDS = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const { applyTheme } = require("/root/.claude/skills/synced/78a27093-4934-4146-a4ce-439be1c78f80_92a5bdf9-cd8b-4905-b7ec-9971d37519be/pptx/scripts/apply_theme.js");

const OUT = process.argv[2];
const NAVY = "0E1726", CARD = "17233A", CARD2 = "1F2E4A", GOLD = "C9A55C", GOLD2 = "E8D5A9",
  IVORY = "F4EFE6", MUTED = "9AA4B5", RED = "C96B5C", LINE = "2B3B5A";
const THEME = {
  name: "Givaudan Iraq", headFontFace: "Arial", bodyFontFace: "Arial",
  colors: { dk1: NAVY, lt1: "FFFFFF", dk2: CARD, lt2: IVORY, accent1: GOLD, accent2: GOLD2, accent3: MUTED,
    accent4: CARD2, accent5: RED, accent6: "6F8FB8", hlink: GOLD, folHlink: GOLD2 },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
pres.title = "استراتيجية صفحة جيفودان العراق";
pres.author = "نور النبراس";
pres.rtlMode = true;
const W = 13.333, M = 0.6, R = W - M, CW = W - 2 * M;

pres.defineSlideMaster({
  title: "DARK", background: { color: NAVY },
  objects: [{ text: { text: "جيفودان العراق  ·  الاستراتيجية", options: { x: R - 5, y: 6.95, w: 5, h: 0.3, fontFace: "Arial", fontSize: 10, color: MUTED, align: "right", rtlMode: true } } }],
  slideNumber: { x: M, y: 6.95, w: 0.6, h: 0.3, fontFace: "Arial", fontSize: 10, color: GOLD },
});
pres.defineSlideMaster({ title: "COVER", background: { color: NAVY } });

async function icon(Comp, color = "#" + GOLD) {
  const svg = RDS.renderToStaticMarkup(React.createElement(Comp, { color, size: 256 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function T(s, text, x, y, w, h, o = {}) {
  s.addText(text, {
    x, y, w, h, fontFace: "Arial", fontSize: o.size || 16, color: o.color || IVORY, bold: !!o.bold, italic: !!o.italic,
    align: o.align || "right", valign: o.valign || "top", rtlMode: true, lang: "ar-IQ", isTextBox: true,
    margin: o.margin ?? 0.04, paraSpaceAfter: o.psa || 0, lineSpacingMultiple: o.lsm || 1.1, fill: o.fill, objectName: o.name,
  });
}
function card(s, x, y, w, h, fill = CARD, line = LINE) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: line, width: 0.75 }, rectRadius: 0.1 });
}
function header(s, kicker, title) {
  T(s, kicker, M, 0.38, CW, 0.35, { size: 13, color: GOLD, bold: true });
  T(s, title, M, 0.72, CW, 0.75, { size: 30, bold: true });
}
// موتيف التموّج: حلقات تنبع من المصدر
function ripples(s, cx, cy, radii, base = 20) {
  radii.forEach((r, i) => s.addShape(pres.ShapeType.ellipse, {
    x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: { type: "none" },
    line: { color: GOLD, width: 1.25, transparency: Math.min(90, base + i * 18) },
  }));
}
function dot(s) { ripples(s, M + 1.05, 7.1, [0.06, 0.12, 0.18], 0); }
let sec = null;
function slide(section, notes) {
  if (section !== sec) { pres.addSection({ title: section }); sec = section; }
  const s = pres.addSlide({ masterName: "DARK", sectionTitle: section });
  dot(s);
  if (notes) s.addNotes(notes);
  return s;
}

(async () => {
  const I = {
    redo: await icon(fa.FaRedo), store: await icon(fa.FaStore), coins: await icon(fa.FaCoins), quiet: await icon(fa.FaCommentSlash),
    ig: await icon(fa.FaInstagram), fb: await icon(fa.FaFacebookF), tt: await icon(fa.FaTiktok), wa: await icon(fa.FaWhatsapp),
    check: await icon(fa.FaCheck), xx: await icon(fa.FaTimes, "#" + RED), flask: await icon(fa.FaFlask), seed: await icon(fa.FaSeedling),
  };

  // 1. الغلاف
  pres.addSection({ title: "الافتتاح" }); sec = "الافتتاح";
  let s = pres.addSlide({ masterName: "COVER", sectionTitle: "الافتتاح" });
  ripples(s, 3.2, 3.75, [0.35, 0.8, 1.3, 1.85, 2.45, 3.1], 0);
  T(s, "GIVAUDAN  ·  IRAQ", 6.2, 1.55, 6.53, 0.4, { size: 14, color: GOLD, bold: true });
  T(s, "جيفودان", 6.2, 1.95, 6.53, 1.3, { size: 66, bold: true, color: IVORY });
  T(s, "من هنا تبدأ الريحة", 6.2, 3.3, 6.53, 0.7, { size: 28, color: GOLD });
  T(s, "استراتيجية الصفحة  |  المرحلة الأولى: التعريف", 6.2, 4.35, 6.53, 0.45, { size: 18, color: IVORY });
  T(s, "مُعدّة لنور النبراس، الوكيل الحصري لجيفودان في العراق  ·  أكتوبر 2026", 6.2, 4.85, 6.53, 0.7, { size: 13, color: MUTED });
  s.addNotes("افتتاح: هذه استراتيجية وليست خطة محتوى. السؤال الذي نجيب عنه: كيف نجعل كل تاجر عطور في العراق يعرف من هي جيفودان؟");

  // 2. الاستراتيجية في جملة
  s = slide("الافتتاح", "الرسالة الأساسية أولاً، ثم التفاصيل. إذا تذكّر الحاضرون جملة واحدة فلتكن هذه.");
  header(s, "الاستراتيجية في جملة واحدة", "لن نبيع زيتاً. سنعرّف السوق بالمصدر");
  const three = [
    ["المشكلة", "التاجر لا يعرف من هي جيفودان، فيقيّمها كأي زيت، ويحسم القرار بالسعر."],
    ["القرار", "مرحلة أولى للتعريف فقط: يرتبط الاسم في ذهن التاجر بفكرة واحدة هي «المصدر»."],
    ["المقياس", "تاجر يذكر جيفودان بالاسم. هذه هي العلامة الحقيقية للنجاح، لا عدد المتابعين."],
  ];
  three.forEach(([h, b], i) => {
    const w = 3.8, x = R - (i + 1) * w - i * 0.36;
    card(s, x, 2.0, w, 3.3);
    T(s, String(i + 1).padStart(2, "0"), x + 0.3, 2.25, w - 0.6, 0.8, { size: 40, bold: true, color: GOLD });
    T(s, h, x + 0.3, 3.1, w - 0.6, 0.5, { size: 22, bold: true });
    T(s, b, x + 0.3, 3.7, w - 0.6, 2.0, { size: 16, color: GOLD2, lsm: 1.25 });
  });

  // 3. أين نقف
  s = slide("أين نقف", "نقطة الصفر ميزة: لا صورة سابقة نصححها. لكن غياب الريلز يعني غيابنا عن مصدر الوصول.");
  header(s, "أين نقف اليوم  ·  حتى 14 أكتوبر 2026", "الصفحة عند نقطة الصفر، وهذه فرصة");
  [["15", "متابعاً"], ["6", "منشورات"], ["0", "ريلز"], ["3", "منصات: إنستغرام، فيسبوك، تيك توك"]].forEach(([n, l], i) => {
    const w = 2.85, x = R - (i + 1) * w - i * 0.24;
    card(s, x, 1.9, w, 2.6);
    T(s, n, x, 2.05, w, 1.4, { size: 66, bold: true, color: i === 2 ? RED : GOLD, align: "center" });
    T(s, l, x + 0.2, 3.5, w - 0.4, 0.8, { size: 15, align: "center", color: IVORY });
  });
  T(s, "القراءة: لا توجد صورة سابقة نحتاج تصحيحها، فنبني الصفحة صحيحة من أول يوم. لكن صفر ريلز يعني أننا غائبون عن الصيغة التي تجلب الوصول على المنصات الثلاث.", M, 4.9, CW, 1.2, { size: 17, color: GOLD2, lsm: 1.3 });

  // 4. المعادلة
  s = slide("التشخيص", "المعادلة التي تحكم قرار التاجر. لدينا طريقان لتغيير النتيجة؛ نختار الثاني لأن خفض السعر لا يليق برأس الهرم.");
  header(s, "لماذا يميل التاجر إلى البديل الأرخص؟", "المعادلة في رأس التاجر");
  T(s, "فرق السعر", R - 3, 1.9, 3, 0.4, { size: 16, bold: true });
  s.addShape(pres.ShapeType.roundRect, { x: R - 9.2, y: 2.35, w: 9.2, h: 0.7, fill: { color: GOLD }, line: { type: "none" }, rectRadius: 0.08 });
  T(s, "فرق الجودة كما يراه التاجر", R - 5, 3.3, 5, 0.4, { size: 16, bold: true });
  s.addShape(pres.ShapeType.roundRect, { x: R - 3.6, y: 3.75, w: 3.6, h: 0.7, fill: { color: CARD2 }, line: { color: GOLD, width: 1, dashType: "dash" }, rectRadius: 0.08 });
  T(s, "النتيجة: يختار الأرخص", M, 3.75, 4.5, 0.7, { size: 20, bold: true, color: RED, valign: "middle" });
  card(s, M, 4.95, CW, 1.6, CARD);
  T(s, [
    { text: "طريقان لتغيير النتيجة: ", options: { bold: true, color: GOLD } },
    { text: "خفض السعر، وهذا ليس خيارنا ولا يليق برأس الهرم. أو تكبير الجودة في عين التاجر، وعليه تُبنى الاستراتيجية كلها. ونبدأ بالاسم لأن الجودة التي لا يُعرف مصدرها لا تُرى." },
  ], M + 0.3, 5.1, CW - 0.6, 1.35, { size: 17, lsm: 1.3, valign: "middle" });

  // 5. Insight
  s = slide("التشخيص", "هنا الفهم الأعمق: القيمة مؤجلة والسعر حاضر. هذا التوتر هو ما نعالجه.");
  header(s, "فهم التاجر  ·  Customer Insight", "التاجر لا يشتري زيتاً");
  [[I.redo, "زبون يرجع"], [I.store, "سمعة محل"], [I.coins, "هامش ربح"], [I.quiet, "شكاوى أقل"]].forEach(([ic, l], i) => {
    const w = 2.85, x = R - (i + 1) * w - i * 0.24;
    card(s, x, 1.85, w, 2.3);
    s.addShape(pres.ShapeType.ellipse, { x: x + w / 2 - 0.5, y: 2.1, w: 1, h: 1, fill: { color: CARD2 }, line: { color: GOLD, width: 1 } });
    s.addImage({ data: ic, x: x + w / 2 - 0.25, y: 2.35, w: 0.5, h: 0.5 });
    T(s, l, x, 3.3, w, 0.55, { size: 20, bold: true, align: "center" });
  });
  T(s, "يشتري هذه الأشياء الأربعة. والمشكلة أن السعر يراه اليوم، ورجوع الزبون لا يراه إلا بعد أسابيع.", M, 4.45, CW, 0.9, { size: 18, color: GOLD2, lsm: 1.3 });
  card(s, M, 5.4, CW, 1.15, CARD2, GOLD);
  T(s, "ما دامت قيمة جيفودان مؤجلة وسعرها حاضراً، سيخسر الاسم المقارنة. مهمتنا أن نجعل القيمة حاضرة قبل أن يرى السعر.", M + 0.3, 5.45, CW - 0.6, 1.05, { size: 18, bold: true, valign: "middle", lsm: 1.25 });

  // 6. الفجوة غير المرئية
  s = slide("التشخيص", "فرضية تحتاج تحققاً عبر عشر مقابلات مع تجار حاليين. لا تُنشر في المرحلة الأولى؛ هي ذخيرة المرحلة الثانية.");
  header(s, "فرضية للتحقق", "الفجوة غير المرئية");
  s.addShape(pres.ShapeType.line, { x: M + 0.6, y: 3.3, w: CW - 1.2, h: 0, line: { color: GOLD, width: 2, endArrowType: "triangle" } });
  const tl = [["الشمّة الأولى", "في المحل، على الورقة", RED, "هنا يقارن التاجر"], ["بعد ساعات", "الثبات على الجلد وتطور النوتات", GOLD, ""], ["بعد أسابيع", "تطابق الدفعات ورجوع الزبون", GOLD, "هنا يظهر الفرق"]];
  tl.forEach(([h, b, c, tag], i) => {
    const cx = R - 1.5 - i * 4.6;
    s.addShape(pres.ShapeType.ellipse, { x: cx - 0.2, y: 3.1, w: 0.4, h: 0.4, fill: { color: c }, line: { color: NAVY, width: 2 } });
    if (tag) {
      s.addShape(pres.ShapeType.roundRect, { x: cx - 1.3, y: 2.15, w: 2.6, h: 0.55, fill: { color: c }, line: { type: "none" }, rectRadius: 0.27 });
      T(s, tag, cx - 1.3, 2.15, 2.6, 0.55, { size: 15, bold: true, color: NAVY, align: "center", valign: "middle" });
    }
    T(s, h, cx - 1.8, 3.75, 3.6, 0.5, { size: 22, bold: true, align: "center" });
    T(s, b, cx - 1.8, 4.3, 3.6, 0.8, { size: 15, color: MUTED, align: "center" });
  });
  T(s, "إن صحّت الفرضية، فالتاجر لا يخطئ في الحكم؛ هو يحكم في التوقيت الخاطئ.", M, 5.55, CW, 0.6, { size: 20, bold: true, color: GOLD2, align: "center" });
  T(s, "التحقق: عشر مقابلات قصيرة مع تجار يتعاملون مع جيفودان حالياً.", M, 6.15, CW, 0.4, { size: 14, color: MUTED, align: "center" });

  // 7. التشخيص
  s = slide("التشخيص", "هذا هو التشخيص الذي تُبنى عليه كل القرارات اللاحقة. توقف هنا قليلاً.");
  ripples(s, W / 2, 3.75, [2.0, 2.6, 3.2], 60);
  T(s, "التشخيص", M, 1.5, CW, 0.5, { size: 16, bold: true, color: GOLD, align: "center" });
  T(s, "جيفودان غير معروفة بالاسم، فتُقيَّم كسلعة.\nوما يُقيَّم كسلعة يُحسم بالسعر.", 1.2, 2.35, W - 2.4, 2.2, { size: 36, bold: true, align: "center", valign: "middle", lsm: 1.35 });
  T(s, "لذلك أول مهمة ليست إقناع التاجر بالجودة، بل تعريفه بالاسم الذي يقف وراءها.", 1.5, 4.85, W - 3, 0.7, { size: 18, color: GOLD2, align: "center" });

  // 8. نضج السوق
  s = slide("التشخيص", "إطار نضج السوق من مدرسة الكتابة الإعلانية المباشرة: في سوق سمع كل الادعاءات لا ينفع ادعاء أكبر، بل هوية جديدة.");
  header(s, "نضج السوق  ·  Market Sophistication", "السوق سمع كل الادعاءات");
  ["ثابت", "فوّاح", "درجة أولى", "أصلي 100%", "أقوى تركيز"].forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3), w = 2.15, x = R - (col + 1) * w - col * 0.2, y = 1.95 + row * 0.95;
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 0.7, fill: { color: CARD }, line: { color: LINE, width: 0.75 }, rectRadius: 0.35 });
    T(s, c, x, y, w, 0.7, { size: 18, color: MUTED, align: "center", valign: "middle" });
    s.addShape(pres.ShapeType.line, { x: x + 0.35, y: y + 0.35, w: w - 0.7, h: 0, line: { color: RED, width: 2 } });
  });
  T(s, "كل بائع زيوت في العراق يقول هذه الكلمات، ففقدت قيمتها.", R - 6.85, 3.95, 6.85, 0.9, { size: 16, color: MUTED, lsm: 1.25 });
  s.addShape(pres.ShapeType.leftArrow, { x: 4.7, y: 2.55, w: 1.2, h: 0.7, fill: { color: GOLD }, line: { type: "none" } });
  ripples(s, 2.6, 2.9, [0.95, 1.35, 1.75], 10);
  T(s, "المصدر", 1.4, 2.5, 2.4, 0.8, { size: 30, bold: true, color: GOLD, align: "center", valign: "middle" });
  card(s, M, 5.0, CW, 1.5, CARD2, GOLD);
  T(s, [
    { text: "في سوق بهذا النضج لا نكسب بادعاء أكبر، بل بهوية جديدة يمكن تصديقها. ", options: { color: IVORY } },
    { text: "جيفودان لا تدّعي أنها جيدة؛ هي الجهة التي يأتي منها الجيد.", options: { color: GOLD, bold: true } },
  ], M + 0.3, 5.1, CW - 0.6, 1.3, { size: 18, valign: "middle", lsm: 1.3 });

  // 9. سلّم الوعي
  s = slide("التشخيص", "التاجر يعرف الفئة ولا يعرف الاسم. أي رسالة تبدأ بالعرض أو المقارنة تقفز درجتين وتسقط.");
  header(s, "مستوى الوعي  ·  Awareness Level", "نبدأ من الدرجة التي يقف عليها التاجر");
  const steps = [["لا يعرف الاسم", "الأولى"], ["يعرف الاسم", "الأولى"], ["يفهم القيمة", "الثانية"], ["يعرف الطريق", "الثانية"], ["يدافع عنها", "الثالثة"]];
  steps.forEach(([h, ph], i) => {
    const w = 2.3, x = R - (i + 1) * w - i * 0.1, hh = 1.2 + i * 0.6, y = 6.55 - hh;
    s.addShape(pres.ShapeType.rect, { x, y, w, h: hh, fill: { color: i < 2 ? GOLD : CARD }, line: { color: i < 2 ? GOLD : LINE, width: 0.75 } });
    T(s, h, x + 0.1, y + 0.12, w - 0.2, 0.5, { size: 17, bold: true, align: "center", color: i < 2 ? NAVY : IVORY });
    T(s, "المرحلة " + ph, x + 0.1, y + 0.58, w - 0.2, 0.4, { size: 13, align: "center", color: i < 2 ? CARD : MUTED });
  });
  s.addShape(pres.ShapeType.roundRect, { x: R - 2.3, y: 4.3, w: 2.3, h: 0.5, fill: { color: IVORY }, line: { type: "none" }, rectRadius: 0.25 });
  T(s, "التاجر اليوم", R - 2.3, 4.3, 2.3, 0.5, { size: 15, bold: true, color: NAVY, align: "center", valign: "middle" });
  T(s, "يعرف الزيوت والموردين والأسعار جيداً، لكنه لا يعرف الاسم: واعٍ بالمنتج، غير واعٍ بالبراند.", M, 1.75, 6.3, 1.2, { size: 16, color: GOLD2, lsm: 1.3 });

  // 10. الاختيارات
  s = slide("الاختيارات", "الاستراتيجية قرار بما لا نفعله بقدر ما هي قرار بما نفعله.");
  header(s, "الاختيارات الاستراتيجية", "ما نختاره، وما نرفضه");
  const ch = [["مخاطبة التاجر", "مخاطبة المستهلك النهائي"], ["بناء الاسم", "بيع المنتج في هذه المرحلة"], ["قصة المصدر", "قصة السعر والعروض"], ["الهدوء والثقة", "الصراخ والمبالغة"], ["تجاهل المنافس", "أي مقارنة، مباشرة أو غير مباشرة"], ["عمق مع جمهور صغير ومحدد", "انتشار واسع بلا قيمة تجارية"], ["التوزيع عبر المبيعات والواتساب", "انتظار أن يأتي التاجر بنفسه"]];
  const cw2 = (CW - 0.3) / 2;
  T(s, "نختار", R - cw2, 1.65, cw2, 0.45, { size: 18, bold: true, color: GOLD });
  T(s, "ونرفض", M, 1.65, cw2, 0.45, { size: 18, bold: true, color: RED });
  ch.forEach(([a, b], i) => {
    const y = 2.15 + i * 0.64;
    card(s, R - cw2, y, cw2, 0.54, CARD);
    s.addImage({ data: I.check, x: R - 0.5, y: y + 0.14, w: 0.26, h: 0.26 });
    T(s, a, R - cw2 + 0.2, y, cw2 - 0.85, 0.54, { size: 16, valign: "middle" });
    card(s, M, y, cw2, 0.54, NAVY);
    s.addImage({ data: I.xx, x: M + cw2 - 0.5, y: y + 0.14, w: 0.26, h: 0.26 });
    T(s, b, M + 0.2, y, cw2 - 0.85, 0.54, { size: 16, valign: "middle", color: MUTED });
  });

  // 11. الهرم
  s = slide("التموضع", "جيفودان رأس الهرم. أي خلط على صفحتها ينزلها درجة.");
  header(s, "جيفودان داخل هرم نور النبراس", "رأس الهرم لا ينظر إلى الأسفل");
  const pyr = [["جيفودان", "الجودة"], ["ADF", "السلاسة"], ["رويال", "الانتشار"], ["فلوراشم", "السعر"]];
  pyr.forEach(([n, r], i) => {
    const w = 2.9 + i * 1.15, cx = 3.6, y = 1.9 + i * 1.12;
    s.addShape(pres.ShapeType.roundRect, { x: cx - w / 2, y, w, h: 0.95, fill: { color: i === 0 ? GOLD : CARD }, line: { color: i === 0 ? GOLD : LINE, width: 0.75 }, rectRadius: 0.08 });
    T(s, n + "  ·  " + r, cx - w / 2, y, w, 0.95, { size: i === 0 ? 20 : 17, bold: true, align: "center", valign: "middle", color: i === 0 ? NAVY : IVORY });
  });
  T(s, "القاعدة", 7.3, 2.0, R - 7.3, 0.45, { size: 18, bold: true, color: GOLD });
  T(s, [
    { text: "البراندات الأخرى يمكن أن تنظر إلى الأعلى نحو جيفودان، لكن صفحة جيفودان لا تنظر إلى الأسفل.", options: { breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "على صفحة جيفودان: لا سعر، ولا ترويج لأي براند آخر من براندات نور النبراس.", options: { color: GOLD2 } },
  ], 7.3, 2.5, R - 7.3, 3.5, { size: 18, lsm: 1.3 });

  // 12. التموضع
  s = slide("التموضع", "بيان التموضع داخلي ولا يُنشر كما هو. في المرحلة الأولى نعلن كل ما فيه عدا الحصرية.");
  header(s, "بيان التموضع (داخلي)", "مكان جيفودان في ذهن التاجر");
  card(s, M, 1.75, CW, 2.55, CARD2, GOLD);
  T(s, [
    { text: "لتاجر العطور في العراق الذي يريد سمعة تدوم، ", options: {} },
    { text: "جيفودان هي المصدر العالمي ", options: { color: GOLD, bold: true } },
    { text: "الذي تُصنع فيه روائح كبرى الماركات، لأنها أكبر شركة في العالم في صناعة العطور والنكهات منذ 1895، " },
    { text: "ونور النبراس هي الطريق إليها في العراق.", options: { color: GOLD2, bold: true } },
  ], M + 0.4, 1.85, CW - 0.8, 2.35, { size: 22, valign: "middle", lsm: 1.4 });
  const vmg = [["الرؤية", "جيفودان مرجع الجودة الأعلى في سوق الزيوت العطرية في العراق، ونور النبراس مصدرها."], ["الرسالة", "أكبر شركة في العالم بصناعة العطور، والجهة التي تقف وراء روائح الماركات العالمية."], ["الهدف", "أن يعرف كل تاجر عطور في العراق من هي جيفودان."]];
  vmg.forEach(([h, b], i) => {
    const w = (CW - 0.6) / 3, x = R - (i + 1) * w - i * 0.3;
    card(s, x, 4.6, w, 1.95);
    T(s, h, x + 0.25, 4.72, w - 0.5, 0.45, { size: 18, bold: true, color: GOLD });
    T(s, b, x + 0.25, 5.2, w - 0.5, 1.25, { size: 15, lsm: 1.25 });
  });

  // 13. الفكرة الكبرى
  s = slide("الفكرة الكبرى", "الفكرة الواحدة: جيفودان هي المصدر. تحقق ثلاثة أشياء في آن واحد، وتعيش في المراحل الثلاث.");
  header(s, "الفكرة الكبرى  ·  Single-Minded Proposition", "جيفودان لا تدخل سباق الصفات");
  ripples(s, 3.4, 4.15, [1.3, 1.75, 2.2, 2.6], 0);
  T(s, "المصدر", 2.0, 3.7, 2.8, 0.9, { size: 32, bold: true, color: GOLD, align: "center", valign: "middle" });
  const eff = [["تُخرجنا من المقارنة", "المصدر لا يُقارن بغيره، فلا حاجة لذكر أي منافس."], ["تبرّر السعر لاحقاً", "حين يفهم التاجر أنها مصدر، يصير السعر الأعلى منطقياً لا عيباً."], ["تمهّد للحصرية", "إن كانت هي المصدر، فالسؤال التالي: ومن أين أحصل عليه؟"]];
  eff.forEach(([h, b], i) => {
    const y = 1.75 + i * 1.3;
    s.addShape(pres.ShapeType.ellipse, { x: R - 0.55, y: y + 0.05, w: 0.55, h: 0.55, fill: { color: GOLD }, line: { type: "none" } });
    T(s, String(i + 1), R - 0.55, y + 0.05, 0.55, 0.55, { size: 16, bold: true, color: NAVY, align: "center", valign: "middle" });
    T(s, h, 6.8, y, R - 7.55, 0.45, { size: 19, bold: true });
    T(s, b, 6.8, y + 0.45, R - 7.55, 0.7, { size: 15, color: MUTED });
  });
  card(s, 6.8, 5.75, R - 6.8, 0.85, CARD2, GOLD);
  T(s, [{ text: "الشعار الموصى به:  ", options: { color: MUTED } }, { text: "من هنا تبدأ الريحة", options: { bold: true, color: GOLD } }], 7.0, 5.75, R - 7.2, 0.85, { size: 20, valign: "middle" });

  // 14. خيارات الشعار
  s = slide("الفكرة الكبرى", "الشعار الموصى به يقول «المصدر» دون ادعاء ودون اسم ماركة، فهو آمن قانونياً.");
  header(s, "خيارات الشعار  ·  Tagline", "ثلاثة خيارات، وتوصية واحدة");
  const tg = [["من هنا تبدأ الريحة", "الموصى به", "يقول «المصدر» دون ادعاء ودون ذكر أي ماركة. آمن قانونياً، ويعيش في المراحل الثلاث.", true], ["قبل الماركة.. جيفودان", "بديل", "قوي ومباشر، لكنه يقترب من أسماء الماركات العالمية ويحتاج حذراً في كل استخدام.", false], ["وراء كل ريحة عالمية.. اسم واحد", "لحملة الإطلاق", "يصلح عنواناً لحملة التعريف الأولى، لكنه طويل كشعار دائم.", false]];
  tg.forEach(([t, tag, b, rec], i) => {
    const w = (CW - 0.6) / 3, x = R - (i + 1) * w - i * 0.3;
    card(s, x, 1.85, w, 4.6, rec ? CARD2 : CARD, rec ? GOLD : LINE);
    s.addShape(pres.ShapeType.roundRect, { x: x + w - 2.05, y: 2.1, w: 1.8, h: 0.45, fill: { color: rec ? GOLD : CARD2 }, line: { type: "none" }, rectRadius: 0.22 });
    T(s, tag, x + w - 2.05, 2.1, 1.8, 0.45, { size: 13, bold: true, color: rec ? NAVY : GOLD2, align: "center", valign: "middle" });
    T(s, "«" + t + "»", x + 0.25, 2.8, w - 0.5, 1.5, { size: 26, bold: true, color: rec ? GOLD : IVORY, valign: "middle", lsm: 1.2 });
    T(s, b, x + 0.25, 4.45, w - 0.5, 1.8, { size: 15, color: MUTED, lsm: 1.3 });
  });

  // 15. بيت الرسائل
  s = slide("الرسائل", "السقف هو ما يخرج به التاجر، والأعمدة أدلة تصديقه، والأساس نور النبراس.");
  header(s, "معمارية الرسائل  ·  Message House", "رسالة واحدة، وأربعة أدلة");
  s.addShape(pres.ShapeType.triangle, { x: M + 0.3, y: 1.55, w: CW - 0.6, h: 1.25, fill: { color: GOLD }, line: { type: "none" } });
  T(s, "جيفودان هي المصدر الذي تُصنع فيه روائح الماركات العالمية", 3.2, 2.2, W - 6.4, 0.55, { size: 17, bold: true, color: NAVY, align: "center", valign: "middle" });
  const pil = [["الإرث", "منذ 1895 في سويسرا، وجذور في غراس الفرنسية تعود إلى 1768"], ["الحجم", "أكبر شركة في العالم في العطور والنكهات"], ["الحِرفة", "مدرسة جيفودان للعطارة منذ 1946"], ["العلم", "بحث وتطوير ومواد خام خلف تركيبات الماركات الكبرى"]];
  pil.forEach(([h, b], i) => {
    const pw = (CW - 0.6 - 0.75) / 4, x = R - 0.3 - (i + 1) * pw - i * 0.25;
    card(s, x, 2.95, pw, 2.45);
    T(s, h, x + 0.2, 3.1, pw - 0.4, 0.5, { size: 20, bold: true, color: GOLD, align: "center" });
    T(s, b, x + 0.2, 3.65, pw - 0.4, 1.6, { size: 15, align: "center", lsm: 1.25 });
  });
  card(s, M + 0.3, 5.55, CW - 0.6, 0.95, CARD2, GOLD);
  T(s, [{ text: "الأساس: ", options: { bold: true, color: GOLD } }, { text: "نور النبراس، العنوان الموثوق لجيفودان في العراق. جهة تواصل في المرحلة الأولى، وحصرية في الثانية." }], M + 0.5, 5.55, CW - 1, 0.95, { size: 16, valign: "middle", align: "center" });

  // 16. الأرقام
  s = slide("الرسائل", "كل رقم يُراجَع مع جيفودان قبل النشر ويُحدَّث سنوياً.");
  header(s, "أدلة الثقة", "أكبر شركة في العالم في صناعة العطور والنكهات");
  [["1895", "سنة التأسيس في سويسرا"], ["7.5", "مليار فرنك سويسري مبيعات 2025"], ["17,000", "موظف تقريباً حول العالم"], ["1946", "تأسيس مدرسة جيفودان للعطارة"]].forEach(([n, l], i) => {
    const w = 2.85, x = R - (i + 1) * w - i * 0.24;
    card(s, x, 2.0, w, 3.0);
    T(s, n, x, 2.3, w, 1.3, { size: 52, bold: true, color: GOLD, align: "center", valign: "middle" });
    T(s, l, x + 0.25, 3.75, w - 0.5, 1.0, { size: 15, align: "center", lsm: 1.2 });
  });
  T(s, "منها 3.8 مليار لقسم العطور والتجميل. ويُنسب إلى مدرسة جيفودان تدريب قرابة ثلث العطّارين المبدعين في العالم.", M, 5.3, CW, 0.7, { size: 16, color: GOLD2 });
  T(s, "المصادر: نتائج جيفودان السنوية 2025 (givaudan.com)، وصفحة Givaudan على Wikipedia. تُراجَع قبل النشر.", M, 6.1, CW, 0.4, { size: 11, color: MUTED });

  // 17. صوت البراند
  s = slide("الصوت", "اللغة قرار استراتيجي: فصحى مبسّطة للمكتوب، وعراقية بيضاء للصوت، ونطق موحّد للاسم.");
  header(s, "صوت البراند  ·  Tone of Voice", "نتكلم كاسم فاخر يعرف قيمته");
  const tov = [["واثقون", "متعالين"], ["خبراء نشرح ببساطة", "أكاديميين نستعرض المصطلحات"], ["هادئون", "صاخبين بالعروض والإيموجي"], ["قريبون من التاجر العراقي", "شعبيين بلغة مبتذلة"]];
  T(s, "نحن", R - 3.6, 1.7, 3.6, 0.4, { size: 16, bold: true, color: GOLD });
  T(s, "ولسنا", R - 7.4, 1.7, 3.6, 0.4, { size: 16, bold: true, color: MUTED });
  tov.forEach(([a, b], i) => {
    const y = 2.15 + i * 0.82;
    card(s, R - 3.6, y, 3.6, 0.68, CARD2);
    T(s, a, R - 3.45, y, 3.3, 0.68, { size: 17, bold: true, valign: "middle" });
    T(s, b, R - 7.4, y, 3.6, 0.68, { size: 17, color: MUTED, valign: "middle" });
  });
  card(s, M, 1.7, 4.9, 4.85, CARD);
  T(s, "قرار اللغة", M + 0.25, 1.85, 4.4, 0.45, { size: 18, bold: true, color: GOLD });
  T(s, [
    { text: "المكتوب: ", options: { bold: true } }, { text: "فصحى مبسّطة بجمل قصيرة.", options: { breakLine: true } },
    { text: "الصوت: ", options: { bold: true } }, { text: "عراقية بيضاء يفهمها تاجر البصرة وتاجر الموصل.", options: { breakLine: true } },
    { text: "الاسم: ", options: { bold: true } }, { text: "«جيفودان» مع Givaudan، يُكتب ويُنطق بشكل واحد دائماً حتى يحفظه السمع." },
  ], M + 0.25, 2.4, 4.4, 2.3, { size: 15, lsm: 1.3, psa: 8 });
  T(s, "نستخدم: المصدر، الأصل، الصنعة، العطّار، التركيبة\nنتجنب: الأفضل، الأرخص، عرض، خصم، «نفس ريحة» + ماركة", M + 0.25, 4.85, 4.4, 1.55, { size: 13, color: GOLD2, lsm: 1.3 });

  // 18. القنوات
  s = slide("القنوات", "الجمهور يُعدّ بالآلاف، وأغلبه لن يتابع صفحة شركة توريد. لذلك كل قطعة تُصنع لتُرسل.");
  header(s, "استراتيجية القنوات", "التوزيع قبل الإنتاج");
  const chn = [[I.ig, "إنستغرام", "الواجهة وملف الاعتماد", "من يبحث عن الاسم يجد الجواب في أول تسعة مربعات وفي الهايلايتس."], [I.fb, "فيسبوك", "الوصول الأكبر للتاجر", "مجموعات التجار، واستهداف ممول حسب المحافظة."], [I.tt, "تيك توك", "الاكتشاف والألفة", "يحفظ السمع الاسم بصيغ قصيرة."], [I.wa, "واتساب + المبيعات", "التوزيع والقياس", "المندوب يرسل المواد ويسجّل كل استفسار يذكر الاسم."]];
  chn.forEach(([ic, n, r, b], i) => {
    const w = 2.85, x = R - (i + 1) * w - i * 0.24;
    card(s, x, 1.75, w, 3.65, i === 3 ? CARD2 : CARD, i === 3 ? GOLD : LINE);
    s.addShape(pres.ShapeType.ellipse, { x: x + w - 1.05, y: 1.95, w: 0.8, h: 0.8, fill: { color: NAVY }, line: { color: GOLD, width: 1 } });
    s.addImage({ data: ic, x: x + w - 0.84, y: 2.16, w: 0.38, h: 0.38 });
    T(s, n, x + 0.2, 2.9, w - 0.4, 0.45, { size: 19, bold: true });
    T(s, r, x + 0.2, 3.35, w - 0.4, 0.4, { size: 14, bold: true, color: GOLD });
    T(s, b, x + 0.2, 3.8, w - 0.4, 1.5, { size: 14, color: MUTED, lsm: 1.25 });
  });
  card(s, M, 5.65, CW, 0.9, CARD);
  T(s, [{ text: "الترويج الممول: ", options: { bold: true, color: GOLD } }, { text: "ميزانية صغيرة مركّزة. استهداف جغرافي، وجمهور مخصص من أرقام التجار لدى نور النبراس، وإعادة استهداف من شاهد الفيديوهات. الهدف تكرار ظهور الاسم للتاجر نفسه." }], M + 0.25, 5.65, CW - 0.5, 0.9, { size: 14, valign: "middle", lsm: 1.2 });

  // 19. القواعد الذهبية
  s = slide("القواعد", "هذه القواعد تحمي التموضع. أي منشور يخالف واحدة منها لا يُنشر.");
  header(s, "القواعد الذهبية للمرحلة الأولى", "ما يُسمح به، وما لا يُسمح به");
  const yes = ["كل رقم أو ادعاء له مصدر رسمي", "الاسم مكتوب ومنطوق بشكل موحّد دائماً", "نور النبراس ظاهرة كجهة تواصل", "الالتزام بدليل هوية جيفودان المعتمد", "كل استفسار يُنقل إلى الواتساب ويُسجّل"];
  const no = ["لا سعر ولا بيع ولا عروض", "لا مقارنة ولا ذكر لوزي، لا تصريحاً ولا تلميحاً", "لا إعلان للحصرية قبل بوابة المرحلة الثانية", "لا ادعاء مطابقة لأي ماركة عالمية مسجلة", "لا خلط مع ADF أو رويال أو فلوراشم"];
  [[yes, I.check, CARD2, IVORY, R - cw2], [no, I.xx, CARD, MUTED, M]].forEach(([arr, ic, fill, col, x]) => {
    arr.forEach((t, i) => {
      const y = 1.75 + i * 0.95;
      card(s, x, y, cw2, 0.8, fill);
      s.addImage({ data: ic, x: x + cw2 - 0.55, y: y + 0.24, w: 0.32, h: 0.32 });
      T(s, t, x + 0.2, y, cw2 - 0.9, 0.8, { size: 16, valign: "middle", color: col });
    });
  });

  // 20. المنافس
  s = slide("القواعد", "نؤيد تجاهل المنافس. لكن التجاهل على الصفحة لا يكفي؛ يجب أن نعرف ماذا نفعل حين يذكره الجمهور.");
  header(s, "سياسة المنافس", "الصمت سياسة، والرد بروتوكول");
  T(s, "ذكر المنافس يمنحه شهرة مجانية، ويضع التاجر الذي يتعامل معه في موقع الدفاع. لذلك لا نذكره أبداً، ونردّ بصيغ ثابتة:", M, 1.6, CW, 0.75, { size: 16, color: GOLD2, lsm: 1.25 });
  const pr = [["سؤال عن السعر", "«تفاصيل الأسعار عند فريقنا على الواتساب» + الرقم. لا سعر في العلن."], ["مقارنة بمنافس", "لا جدال ولا ذكر للاسم. نعيد الحديث إلى المصدر وننقله إلى الخاص."], ["«غالية»", "لا تبرير في العلن. شكر ونقل إلى الخاص، والمندوب يتعامل معها وجهاً لوجه."], ["تشكيك أو جهة تدّعي البيع", "نقل فوري إلى الخاص وتوثيق الحالة. تُستخدم لتسريع طرح الحصرية."]];
  pr.forEach(([a, b], i) => {
    const y = 2.5 + i * 1.0;
    card(s, R - 3.7, y, 3.7, 0.85, CARD2);
    T(s, a, R - 3.55, y, 3.4, 0.85, { size: 16, bold: true, valign: "middle", color: GOLD });
    card(s, M, y, CW - 3.9, 0.85, CARD);
    T(s, b, M + 0.2, y, CW - 4.3, 0.85, { size: 15, valign: "middle" });
  });

  // 21. القياس
  s = slide("القياس", "أضفنا طبقة رابعة تقيس الهدف نفسه: هل يعرف التاجر جيفودان؟ سؤال شهري بسيط يطرحه المندوبون.");
  header(s, "منظومة القياس", "من التعرّض إلى التذكّر");
  const kp = [["1. التعرّض", "الوصول + المشاهدات", "هل وصل الاسم؟"], ["2. التأثير", "(الحفظ + المشاركة) ÷ الوصول", "هل رأى قيمة تستحق الإرسال؟"], ["3. التعرّف", "الاستفسارات بالاسم في واتساب والمبيعات", "هل صار الاسم في كلامه؟"], ["4. التذكّر (جديد)", "30 تاجراً شهرياً: «لمن تسمع جيفودان، شنو أول شي يجي ببالك؟»", "هل تحقق الهدف فعلاً؟"]];
  kp.forEach(([n, m, q], i) => {
    const w = 5.6 - i * 0.7, y = 1.7 + i * 1.08, x = R - 2.9 - w / 2;
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 0.92, fill: { color: i === 3 ? GOLD : CARD2 }, line: { color: GOLD, width: 0.75 }, rectRadius: 0.08 });
    T(s, n, x, y, w, 0.92, { size: 18, bold: true, align: "center", valign: "middle", color: i === 3 ? NAVY : IVORY });
    T(s, m, M, y, 6.2, 0.55, { size: 13, bold: true, valign: "middle" });
    T(s, q, M, y + 0.5, 6.2, 0.4, { size: 13, color: MUTED });
  });
  card(s, M, 6.05, CW, 0.6, CARD);
  T(s, [{ text: "لا نعدّه نجاحاً: ", options: { bold: true, color: RED } }, { text: "المتابعون والإعجابات.   ", options: {} }, { text: "خط الأساس: ", options: { bold: true, color: GOLD } }, { text: "أول 4 أسابيع، ثم تُحدَّد الأهداف الرقمية." }], M + 0.2, 6.05, CW - 0.4, 0.6, { size: 14, valign: "middle" });

  // 22. البوابة
  s = slide("القياس", "ننتقل بالشروط لا بالتاريخ. الأرقام النهائية تُعتمد بعد خط الأساس.");
  header(s, "بوابة المرحلة الثانية", "ننتقل بالشروط، لا بالتاريخ");
  const gate = [["3 أشهر", "نمو متتالٍ في الاستفسارات بالاسم"], ["40%+", "من عيّنة التذكّر يربطون جيفودان بالعالمية أو المصدر"], ["فوق الأساس", "معدل الحفظ والمشاركة مستقر"]];
  gate.forEach(([n, l], i) => {
    const w = (CW - 0.6) / 3, x = R - (i + 1) * w - i * 0.3;
    card(s, x, 1.85, w, 2.7);
    T(s, n, x, 2.05, w, 1.1, { size: 40, bold: true, color: GOLD, align: "center", valign: "middle" });
    T(s, l, x + 0.3, 3.25, w - 0.6, 1.1, { size: 16, align: "center", lsm: 1.25 });
  });
  card(s, M, 4.85, CW, 1.65, CARD2, RED);
  T(s, [{ text: "استثناء يسرّع الانتقال", options: { bold: true, color: RED, breakLine: true } }, { text: "إذا رُصدت جهات تدّعي بيع جيفودان وتستفيد من الوعي الذي نبنيه، نطرح الحصرية فوراً دون انتظار باقي الشروط. هذا أكبر خطر في تأجيل الحصرية." }], M + 0.3, 4.95, CW - 0.6, 1.45, { size: 17, lsm: 1.3, valign: "middle" });

  // 23. المراحل
  s = slide("خارطة المراحل", "المرحلة الثالثة مقترح إضافي: برنامج «تاجر جيفودان المعتمد» يحوّل الجودة من كلفة يدفعها التاجر إلى ميزة يربح منها.");
  header(s, "خارطة المراحل", "من الاسم، إلى الحصرية، إلى الشراكة");
  const ph = [["01", "التعريف", "«منو جيفودان؟»", "ربط الاسم بفكرة المصدر", "الاستفسارات بالاسم + التذكّر"], ["02", "الحصرية والفجوة", "«ومنين أجيبها؟»", "الأصل من نور النبراس فقط، وجعل الفجوة غير المرئية مرئية", "طلبات التعامل الجديدة"], ["03", "الشراكة (مقترحة)", "«شلون أربح منها أكثر؟»", "برنامج «تاجر جيفودان المعتمد» بعد موافقة جيفودان", "عدد التجار الشركاء واستمرارهم"]];
  ph.forEach(([n, h, q, m, k], i) => {
    const w = 3.6, gap = (CW - 3 * w) / 2, x = R - (i + 1) * w - i * gap;
    card(s, x, 1.75, w, 4.8, i === 0 ? CARD2 : CARD, i === 0 ? GOLD : LINE);
    T(s, n, x + 0.25, 1.9, w - 0.5, 0.75, { size: 36, bold: true, color: GOLD });
    T(s, h, x + 0.25, 2.65, w - 0.5, 0.5, { size: 20, bold: true });
    T(s, q, x + 0.25, 3.2, w - 0.5, 0.5, { size: 16, color: GOLD2, italic: true });
    T(s, m, x + 0.25, 3.8, w - 0.5, 1.3, { size: 15, lsm: 1.25 });
    T(s, "المؤشر: " + k, x + 0.25, 5.3, w - 0.5, 1.0, { size: 13, color: MUTED, lsm: 1.2 });
    if (i < 2) s.addShape(pres.ShapeType.leftArrow, { x: x - gap + 0.08, y: 3.95, w: gap - 0.16, h: 0.4, fill: { color: GOLD }, line: { type: "none" } });
  });

  // 24. المخاطر
  s = slide("المخاطر", "كل خطر له معالجة محددة ومسؤول.");
  header(s, "المخاطر", "ما قد يكسر الاستراتيجية، وكيف نمنعه");
  const rk = [["عالٍ", "أن نبني وعياً بالاسم فيقطفه غيرنا", "نور النبراس ظاهرة كجهة تواصل من اليوم الأول، ورصد مدّعي البيع يسرّع المرحلة الثانية."], ["عالٍ", "استخدام اسم وشعار جيفودان دون موافقة", "طلب دليل الهوية وموافقة مكتوبة قبل أي حملة ممولة."], ["عالٍ", "ادعاءات تخص ماركات عالمية مسجلة", "نقول «تصنع لكبرى الماركات» دون أسماء، إلا ما نشرته جيفودان رسمياً."], ["متوسط", "تفاعل منخفض ظاهرياً لصغر الجمهور", "نحكم بمؤشرات التعرّف والتذكّر، لا بالإعجابات."], ["متوسط", "عدم التزام المبيعات بالتسجيل", "جدول من أربعة حقول وجلسة تعريف 30 دقيقة."]];
  rk.forEach(([lv, r, m], i) => {
    const y = 1.7 + i * 0.97;
    s.addShape(pres.ShapeType.roundRect, { x: R - 1.2, y: y + 0.17, w: 1.2, h: 0.48, fill: { color: lv === "عالٍ" ? RED : CARD2 }, line: { type: "none" }, rectRadius: 0.24 });
    T(s, lv, R - 1.2, y + 0.17, 1.2, 0.48, { size: 13, bold: true, align: "center", valign: "middle", color: lv === "عالٍ" ? NAVY : GOLD2 });
    card(s, R - 5.6, y, 4.25, 0.82, CARD2);
    T(s, r, R - 5.45, y, 3.95, 0.82, { size: 15, bold: true, valign: "middle" });
    card(s, M, y, R - 5.75 - M, 0.82, CARD);
    T(s, m, M + 0.2, y, R - 6.15 - M, 0.82, { size: 14, valign: "middle", color: GOLD2 });
  });

  // 25. القرارات
  s = slide("الخطوات التالية", "نختم بما نحتاجه من نور النبراس حتى تبدأ الاستراتيجية فعلياً.");
  header(s, "القرارات المطلوبة الآن", "ستة قرارات لننطلق");
  const dec = ["اعتماد التموضع والفكرة الكبرى والشعار", "طلب دليل الهوية وموافقة جيفودان على استخدام الاسم والشعار", "رقم واتساب موحّد وجدول تسجيل الاستفسارات بالاسم", "ميزانية ترويج شهرية صغيرة ومركّزة", "جلسة 30 دقيقة مع فريق المبيعات", "عشر مقابلات مع تجار حاليين لاختبار فرضية الفجوة"];
  dec.forEach((d, i) => {
    const col = i % 2, row = Math.floor(i / 2), x = col === 0 ? R - cw2 : M, y = 1.8 + row * 1.5;
    card(s, x, y, cw2, 1.25);
    T(s, String(i + 1).padStart(2, "0"), x + cw2 - 1.15, y, 0.95, 1.25, { size: 32, bold: true, color: GOLD, valign: "middle", align: "center" });
    T(s, d, x + 0.25, y, cw2 - 1.5, 1.25, { size: 17, valign: "middle", lsm: 1.2 });
  });

  // 26. الختام
  pres.addSection({ title: "الختام" });
  s = pres.addSlide({ masterName: "COVER", sectionTitle: "الختام" });
  ripples(s, W / 2, 3.6, [2.75, 3.25, 3.75], 30);
  T(s, "من هنا تبدأ الريحة", 1.5, 2.75, W - 3, 1.0, { size: 44, bold: true, align: "center", valign: "middle" });
  T(s, "جيفودان  ·  GIVAUDAN", 1.5, 3.85, W - 3, 0.5, { size: 18, color: GOLD, bold: true, align: "center" });
  T(s, "عبر نور النبراس في العراق", 1.5, 4.35, W - 3, 0.5, { size: 15, color: MUTED, align: "center" });
  s.addNotes("ختام: العودة إلى الشعار. شكراً، وأسئلة.");

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("written", OUT);
})();
