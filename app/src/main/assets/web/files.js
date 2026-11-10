/* ═══════════════════ NEW LIFE: الحجم والجودة + الأرشيف (ZIP / فك الضغط / مدير الأرشيف) ═══════════════════
   يعمل داخل الهاتف دون إنترنت:
   - تصغير حجم الصور وPDF وWord/Excel/PowerPoint والنصوص حتى حجم تحدده (مثل 1 MB) بأفضل جودة ممكنة
   - تكبير الصور (والصور داخل PDF والمستندات) حتى 5 MB مع زيادة الحدة وإزالة التشويش وتحسين الألوان
   - إنشاء ZIP (مع كلمة مرور AES-256) وTAR.GZ، وفك ضغط ZIP و7Z وRAR وTAR وGZ وISO...
   - مدير أرشيف: تصفح المجلدات، بحث، فتح ملف مباشرة، استخراج الكل أو المحدد، إضافة، مجلد جديد، إعادة تسمية، حذف، فحص */
(function nlFiles() {
"use strict";
const PL = window.PDFLib;
const N = n => PL.PDFName.of(n);

/* ───────── أدوات عامة ───────── */
function hs(n) {
  if (n == null || isNaN(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
const MB = 1048576;
const h = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nextFrame = () => new Promise(r => setTimeout(r, 0));
const ENC_UNSUP = "أرشيف 7Z أو RAR المحمي بكلمة مرور لا يُفتح في الهاتف بعد — افتحه ببرنامج NEW LIFE على الكمبيوتر (ملفات ZIP المحمية تُفتح هنا عادي)";
const laErr = e => /encrypted, but currently not supported|not supported.*encrypt|encrypt.*not supported/i.test(e?.message || "") ? new Error(ENC_UNSUP) : e;
function pwErr(msg) { const e = new Error(msg || "PASSWORD"); e.pw = true; return e; }
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("تعذر تحميل " + src)); document.head.append(s); });
}
let _zipP = null, _laP = null;
function zipLib() {
  return _zipP ||= (window.zip ? Promise.resolve() : loadScript("lib/zip-full.min.js")).then(() => { zip.configure({ useWebWorkers: false }); return zip; }, e => { _zipP = null; throw e; });
}
function laLib() {
  return _laP ||= import(new URL("lib/archive/libarchive.js", location.href).href).then(m => { m.Archive.init({ workerUrl: new URL("lib/archive/worker-bundle.js", location.href).href }); return m; }, e => { _laP = null; throw e; });
}
function askPw(title, text) {
  return sheet((b, close) => {
    b.insertAdjacentHTML("beforeend", `<h2></h2><p class="lead"></p>
      <label class="field"><span>كلمة المرور</span><input type="password" id="apw" autocomplete="off" style="border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-height:42px;background:var(--surface)"></label>
      <label class="row" style="gap:8px;font-size:14px;display:flex;align-items:center"><input type="checkbox" id="apwShow" style="width:20px;height:20px">إظهار كلمة المرور</label>
      <div class="acts"><button class="btn" data-v="0">إلغاء</button><button class="btn primary" data-v="1">متابعة</button></div>`);
    b.querySelector("h2").textContent = title; b.querySelector("p").textContent = text;
    const inp = b.querySelector("#apw");
    b.querySelector("#apwShow").onchange = e => inp.type = e.target.checked ? "text" : "password";
    setTimeout(() => inp.focus(), 60);
    inp.onkeydown = e => { if (e.key === "Enter" && inp.value) close(inp.value); };
    b.querySelector('[data-v="0"]').onclick = () => close(null);
    b.querySelector('[data-v="1"]').onclick = () => { if (inp.value) close(inp.value); else toast("أدخل كلمة المرور"); };
  });
}
function askText(title, label, value = "") {
  return sheet((b, close) => {
    b.insertAdjacentHTML("beforeend", `<h2></h2><label class="field"><span></span><input type="text" id="atx" style="border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-height:42px;background:var(--surface)"></label>
      <div class="acts"><button class="btn" data-v="0">إلغاء</button><button class="btn primary" data-v="1">موافق</button></div>`);
    b.querySelector("h2").textContent = title; b.querySelector("span").textContent = label;
    const inp = b.querySelector("#atx"); inp.value = value; setTimeout(() => { inp.focus(); inp.select(); }, 60);
    inp.onkeydown = e => { if (e.key === "Enter") close(inp.value.trim() || null); };
    b.querySelector('[data-v="0"]').onclick = () => close(null);
    b.querySelector('[data-v="1"]').onclick = () => close(inp.value.trim() || null);
  });
}
function choose(title, items, text = "") {   // items: [[key, label, desc]]
  return sheet((b, close) => {
    b.insertAdjacentHTML("beforeend", `<h2></h2>${text ? '<p class="lead"></p>' : ""}<div class="cvlist">${items.map(([k, n, d]) => `<button data-k="${h(k)}"><strong dir="auto">${h(n)}</strong><small>${h(d || "")}</small></button>`).join("")}</div>`);
    b.querySelector("h2").textContent = title; if (text) b.querySelector("p").textContent = text;
    b.querySelectorAll("[data-k]").forEach(x => x.onclick = () => close(x.dataset.k));
  });
}

/* ───────── الحفظ في مجلد يختاره المستخدم (عدة ملفات دفعة واحدة) ───────── */
async function saveManyToFolder(items, sub) {   // items: [{path, blob}]
  if (!items.length) return false;
  if (!NL || !NL.folderWrite) {   // احتياط: حفظ كل ملف على حدة
    for (const it of items) if (!await saveFile(it.path.split("/").pop(), it.blob)) return false;
    return true;
  }
  let r;
  try { r = JSON.parse(await native("folderOpen", [sub || ""])); }
  catch (e) { if (e.message !== "declined") toast("تعذر فتح المجلد: " + e.message); return false; }
  try {
    for (let i = 0; i < items.length; i++) {
      busy(`حفظ ${i + 1} من ${items.length}: ${items[i].path.split("/").pop()}`);
      const it = items[i]; const blob = typeof it.blob === "function" ? await it.blob() : it.blob;
      const tok = await putBlob(blob, extOf(it.path) || "bin");
      const err = NL.folderWrite(r.id, it.path, tok); if (err) throw new Error(err);
    }
    toast(`تم حفظ ${items.length} ملف في «${r.name}»`, 4500); return true;
  } catch (e) { toast("تعذر الحفظ: " + e.message, 5000); return false; }
  finally { busy(); try { NL.folderClose(r.id); } catch (e) {} }
}
/* اختيار مجلد كامل من الهاتف (لضغطه) — يعيد [{path, file}] */
async function pickFolderFiles() {
  if (!NL || !NL.pickFolder) { toast("اختيار مجلد كامل يعمل داخل تطبيق NEW LIFE — اختر الملفات بدلاً من ذلك"); return null; }
  let r;
  try { busy("جاري قراءة المجلد..."); r = JSON.parse(await native("pickFolder", [])); }
  catch (e) { busy(); if (e.message !== "declined") toast("تعذر قراءة المجلد: " + e.message); return null; }
  try {
    const out = [];
    for (const f of r.files) out.push({ path: f.path, url: f.url, size: f.size, date: f.mtime ? new Date(f.mtime) : new Date(), lazy: true });
    for (const d of r.dirs || []) out.push({ path: d, dir: true });
    return { name: r.name, items: out };
  } finally { busy(); }
}
async function itemBlob(it) { if (it.file) return it.file; if (it.url) { const b = await fetchBlob(it.url); return b; } return new Blob([]); }

/* ═════════════════════════ محرك الصور ═════════════════════════ */
const MAXPIX_ENC = 36e6, MAXPIX_ENH = 24e6, MAXSIDE = 12000;
function cnv(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
function toBlobP(c, type, q) {
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("تعذر ترميز الصورة — قد تكون كبيرة جداً لذاكرة الهاتف")), type, q));
}
async function decodeImg(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch (e) {
    try { const img = await loadImg(blob instanceof File ? blob : new File([blob], "img")); return img; }
    catch (x) { throw new Error("تعذر قراءة الصورة (صيغة غير مدعومة في الهاتف مثل HEIC؟ حوّلها إلى JPG أولاً)"); }
  }
}
const wOf = s => s.naturalWidth || s.width, hOf = s => s.naturalHeight || s.height;
function hasAlpha(src) {
  const c = cnv(48, 48), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(src, 0, 0, 48, 48); const d = x.getImageData(0, 0, 48, 48).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}
function drawTo(src, w, h, { bg = null, filter = null } = {}) {
  const c = cnv(w, h), x = c.getContext("2d");
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  if (filter) x.filter = filter;
  x.drawImage(src, 0, 0, w, h); return c;
}
/* تغيير الأبعاد على مراحل (أوضح من خطوة واحدة) */
function resample(src, w, h, opts = {}) {
  let cur = src, cw = wOf(src), ch = hOf(src);
  if (w < cw) { while (cw / 2 > w * 1.05) { cw = Math.round(cw / 2); ch = Math.round(ch / 2); cur = drawTo(cur, cw, ch); } }
  else if (w > cw) { while (cw * 2 < w * 0.95) { cw *= 2; ch *= 2; cur = drawTo(cur, cw, ch); } }
  return drawTo(cur, w, h, opts);
}
/* زيادة الحدة (Unsharp mask) على شرائح لتوفير الذاكرة */
function unsharp(c, amount = 0.7, radius = 1) {
  const w = c.width, hh = c.height, x = c.getContext("2d", { willReadFrequently: true });
  const bl = cnv(w, hh), bx = bl.getContext("2d", { willReadFrequently: true });
  bx.filter = `blur(${radius}px)`; bx.drawImage(c, 0, 0);
  const band = Math.max(1, Math.floor(3e6 / w));
  for (let y = 0; y < hh; y += band) {
    const n = Math.min(band, hh - y), a = x.getImageData(0, y, w, n), b = bx.getImageData(0, y, w, n), d = a.data, e = b.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) { const diff = d[i + k] - e[i + k]; if (diff > 2 || diff < -2) d[i + k] = d[i + k] + amount * diff; }
    }
    x.putImageData(a, 0, y);
  }
  bl.width = bl.height = 1;
  return c;
}
const IMG_TYPES = { jpg: "image/jpeg", webp: "image/webp", png: "image/png" };

/* تصغير صورة: حجم مستهدف (بايت) أو جودة يدوية */
async function imgCompress(blob, o, prog) {
  const src = await decodeImg(blob); const W = wOf(src), H = hOf(src);
  let fmt = o.fmt || "auto"; const alpha = hasAlpha(src);
  if (fmt === "auto") fmt = alpha ? "webp" : "jpg";
  const type = IMG_TYPES[fmt], bg = fmt === "jpg" ? "#ffffff" : null;
  let scale = Math.min(1, Math.sqrt(MAXPIX_ENC / (W * H)), MAXSIDE / Math.max(W, H));
  if (o.maxSide) scale = Math.min(scale, o.maxSide / Math.max(W, H));
  const render = s => resample(src, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)), { bg });
  const pack = (b, c, q) => ({ blob: b, ext: fmt, info: `${c.width}×${c.height}${q != null && fmt !== "png" ? ` · جودة ${Math.round(q * 100)}%` : ""}` });
  if (!o.target) { const q = o.quality ?? 0.8; const c = render(scale); return pack(await toBlobP(c, type, q), c, q); }
  let last = null;
  for (let it = 0; it < 9; it++) {
    prog?.(`محاولة ${it + 1}...`);
    const c = render(scale);
    if (fmt === "png") {
      const b = await toBlobP(c, type); last = pack(b, c);
      if (b.size <= o.target || c.width < 40) return last;
      scale *= Math.sqrt(o.target / b.size) * 0.95; continue;
    }
    const top = await toBlobP(c, type, 0.92);
    if (top.size <= o.target) return pack(top, c, 0.92);
    let lo = 0.42, hi = 0.92;
    const low = await toBlobP(c, type, lo); last = pack(low, c, lo);
    if (low.size <= o.target) {
      let got = { b: low, q: lo };
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2, b = await toBlobP(c, type, m); if (b.size <= o.target) { lo = m; got = { b, q: m }; } else hi = m; }
      return pack(got.b, c, got.q);
    }
    if (c.width < 40) return last;
    scale *= Math.sqrt(o.target / low.size) * 0.9;   // تصغير الأبعاد ثم إعادة المحاولة
  }
  return last;
}

/* تكبير صورة مع تحسين الوضوح حتى حجم مستهدف */
function enhanceCanvas(src, s, o) {
  const W = wOf(src), H = hOf(src);
  const filters = [];
  if (o.color) filters.push("contrast(1.06) saturate(1.12)");
  let base = src;
  if (o.denoise) base = drawTo(src, W, H, { filter: "blur(0.6px)" });
  const c = resample(base, Math.round(W * s), Math.round(H * s), { filter: filters.join(" ") || null });
  if (o.sharpen) unsharp(c, 0.55 + 0.25 * Math.log2(Math.max(1, s)) + (o.denoise ? 0.2 : 0), s >= 2 ? 1.2 : 1);
  return c;
}
async function imgEnhance(blob, o, prog) {
  const src = await decodeImg(blob); const W = wOf(src), H = hOf(src);
  const alpha = hasAlpha(src); const type = alpha ? "image/png" : "image/jpeg", ext = alpha ? "png" : "jpg";
  const cap = Math.min(Math.sqrt(MAXPIX_ENH / (W * H)), MAXSIDE / Math.max(W, H));
  const sMax = Math.max(Math.min(1, cap), Math.min(o.maxScale || 4, cap));
  const q = 0.93;
  let s = sMax, best = null;
  for (let it = 0; it < 6; it++) {
    prog?.(`تكبير ×${s.toFixed(2)}...`); await nextFrame();
    const c = enhanceCanvas(src, s, o); const b = await toBlobP(c, type, q);
    const r = { blob: b, ext, info: `${W}×${H} ← ${c.width}×${c.height} (×${s.toFixed(2)})` };
    c.width = c.height = 1;
    if (b.size <= o.target) return r;
    best = r;
    if (s <= 1.001) break;
    s = Math.max(1, s * Math.sqrt(o.target / b.size) * 0.97);
  }
  // الحجم أكبر من المستهدف حتى بدون تكبير: نخفض الجودة قليلاً
  const c = enhanceCanvas(src, 1, o);
  for (const qq of [0.88, 0.82, 0.75]) { const b = await toBlobP(c, "image/jpeg", qq); if (b.size <= o.target) return { blob: b, ext: "jpg", info: `${W}×${H} · جودة ${Math.round(qq * 100)}%` }; }
  return best;
}

/* ═════════════════════════ محرك PDF ═════════════════════════ */
const num = x => x == null ? null : typeof x.asNumber === "function" ? x.asNumber() : typeof x.numberValue === "number" ? x.numberValue : null;
async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
function unpredict(data, parms, ctx) {
  if (!parms) return data;
  const P = num(ctx.lookup(parms.get(N("Predictor")))) || 1;
  if (P === 1) return data;
  if (P < 10) return null;   // TIFF predictor: غير مدعوم
  const colors = num(ctx.lookup(parms.get(N("Colors")))) || 1, bpc = num(ctx.lookup(parms.get(N("BitsPerComponent")))) || 8, cols = num(ctx.lookup(parms.get(N("Columns")))) || 1;
  const rowLen = Math.ceil(colors * bpc * cols / 8), bpp = Math.max(1, Math.ceil(colors * bpc / 8));
  const rows = Math.floor(data.length / (rowLen + 1)); const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)], inp = r * (rowLen + 1) + 1, o = r * rowLen, up = o - rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[inp + i], a = i >= bpp ? out[o + i - bpp] : 0, b = r ? out[up + i] : 0, c = r && i >= bpp ? out[up + i - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = raw; break; case 1: v = raw + a; break; case 2: v = raw + b; break; case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: return null;
      }
      out[o + i] = v & 255;
    }
  }
  return out;
}
async function csInfo(cs, ctx) {
  cs = ctx.lookup(cs);
  if (cs instanceof PL.PDFName) {
    if (cs === N("DeviceRGB") || cs === N("CalRGB")) return { n: 3 };
    if (cs === N("DeviceGray") || cs === N("CalGray")) return { n: 1 };
    if (cs === N("DeviceCMYK")) return { n: 4 };
    return null;
  }
  if (cs instanceof PL.PDFArray) {
    const k = ctx.lookup(cs.get(0));
    if (k === N("ICCBased")) { const st = ctx.lookup(cs.get(1)); const n = num(ctx.lookup(st?.dict?.get(N("N")))); return n === 1 || n === 3 || n === 4 ? { n } : null; }
    if (k === N("CalRGB")) return { n: 3 };
    if (k === N("CalGray")) return { n: 1 };
    if (k === N("Indexed")) {
      const base = await csInfo(cs.get(1), ctx); if (!base) return null;
      const hival = num(ctx.lookup(cs.get(2))); let lut = ctx.lookup(cs.get(3)), bytes = null;
      if (lut instanceof PL.PDFRawStream) { const f = ctx.lookup(lut.dict.get(N("Filter"))); bytes = !f ? lut.contents : f === N("FlateDecode") ? await inflate(lut.contents) : null; }
      else if (lut && typeof lut.asBytes === "function") bytes = lut.asBytes();
      if (!bytes) return null;
      return { n: 1, indexed: { base: base.n, hival, lut: bytes } };
    }
  }
  return null;
}
/* فك صورة من PDF إلى مصدر رسم (ImageBitmap أو Canvas). يعيد null للصور التي نتركها كما هي */
async function pdfImgDecode(obj, ctx) {
  const d = obj.dict, L = k => ctx.lookup(d.get(N(k)));
  if (L("ImageMask") === PL.PDFBool.True || L("Mask") || L("Decode")) return null;
  const w = num(L("Width")), hh = num(L("Height")), bpc = num(L("BitsPerComponent")) || 8;
  if (!w || !hh || w * hh < 96 * 96 || w * hh > 40e6) return null;
  let f = L("Filter"); const filters = !f ? [] : f instanceof PL.PDFArray ? f.asArray().map(x => ctx.lookup(x)) : [f];
  const cs = await csInfo(d.get(N("ColorSpace")), ctx); if (!cs) return null;
  if (filters.length === 1 && filters[0] === N("DCTDecode")) {
    if (cs.n === 4 || cs.indexed) return null;   // CMYK: نتركها (الألوان قد تنقلب)
    try { return { src: await createImageBitmap(new Blob([obj.contents], { type: "image/jpeg" })), w, h: hh, jpeg: true }; } catch (e) { return null; }
  }
  const flate = filters.length === 1 && filters[0] === N("FlateDecode");
  if (!flate && filters.length) return null;
  if (bpc === 16 || (cs.n > 1 && bpc !== 8)) return null;
  let parms = L("DecodeParms"); if (parms instanceof PL.PDFArray) parms = ctx.lookup(parms.get(0));
  let data;
  try { data = flate ? unpredict(await inflate(obj.contents), parms instanceof PL.PDFDict ? parms : null, ctx) : obj.contents; } catch (e) { return null; }
  if (!data) return null;
  const n = cs.n, rowLen = Math.ceil(n * bpc * w / 8);
  if (data.length < rowLen * hh) return null;
  const c = cnv(w, hh), x = c.getContext("2d"), img = x.createImageData(w, hh), px = img.data;
  const maxv = (1 << bpc) - 1;
  for (let y = 0; y < hh; y++) {
    const ro = y * rowLen;
    for (let i = 0; i < w; i++) {
      const p = (y * w + i) * 4; let r, g, b;
      if (n === 1) {
        let v;
        if (bpc === 8) v = data[ro + i];
        else { const bit = i * bpc, byte = data[ro + (bit >> 3)], sh = 8 - bpc - (bit & 7); v = (byte >> sh) & maxv; }
        if (cs.indexed) {
          const ix = Math.min(v, cs.indexed.hival), bn = cs.indexed.base, L2 = cs.indexed.lut, o = ix * bn;
          if (bn === 3) { r = L2[o]; g = L2[o + 1]; b = L2[o + 2]; }
          else if (bn === 1) { r = g = b = L2[o]; }
          else { const C = L2[o] / 255, M = L2[o + 1] / 255, Y = L2[o + 2] / 255, K = L2[o + 3] / 255; r = 255 * (1 - C) * (1 - K); g = 255 * (1 - M) * (1 - K); b = 255 * (1 - Y) * (1 - K); }
        } else { r = g = b = bpc === 8 ? v : Math.round(v * 255 / maxv); }
      } else if (n === 3) { const o = ro + i * 3; r = data[o]; g = data[o + 1]; b = data[o + 2]; }
      else { const o = ro + i * 4, C = data[o] / 255, M = data[o + 1] / 255, Y = data[o + 2] / 255, K = data[o + 3] / 255; r = 255 * (1 - C) * (1 - K); g = 255 * (1 - M) * (1 - K); b = 255 * (1 - Y) * (1 - K); }
      px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return { src: c, w, h: hh, jpeg: false };
}
function pdfImageList(doc) {
  const out = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PL.PDFRawStream && obj.dict.get(N("Subtype")) === N("Image")) out.push({ ref, obj });
  }
  return out;
}
function replaceImage(doc, ref, oldObj, jpg, w, h) {
  const dict = { Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" };
  const sm = oldObj.dict.get(N("SMask")); if (sm) dict.SMask = sm;
  const it = oldObj.dict.get(N("Interpolate")); if (it) dict.Interpolate = it;
  doc.context.assign(ref, doc.context.stream(jpg, dict));
}
async function loadPdfDoc(bytes) {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { if (/encrypt/i.test(e.message || "")) throw new Error("الملف محمي بكلمة مرور — افتحه في NEW LIFE وأزل الحماية أولاً"); throw e; }
}
/* مستويات ضغط صور PDF: [أقصى بُعد بالبكسل، الجودة] من الأفضل جودة إلى الأصغر حجماً */
const PDF_LEVELS = [[3000, 0.85], [2400, 0.8], [2000, 0.75], [1700, 0.7], [1450, 0.64], [1250, 0.58], [1050, 0.52], [900, 0.46], [760, 0.4], [640, 0.34]];
async function pdfAtLevel(bytes, [maxSide, q], prog) {
  const doc = await loadPdfDoc(bytes); const list = pdfImageList(doc); let changed = 0;
  for (let i = 0; i < list.length; i++) {
    const { ref, obj } = list[i]; prog?.(`صورة ${i + 1} من ${list.length}`);
    const dec = await pdfImgDecode(obj, doc.context); if (!dec) continue;
    const s = Math.min(1, maxSide / Math.max(dec.w, dec.h));
    if (dec.jpeg && s >= 1 && q >= 0.8) { dec.src.close?.(); continue; }
    const c = resample(dec.src, Math.max(1, Math.round(dec.w * s)), Math.max(1, Math.round(dec.h * s)), { bg: "#ffffff" });
    const jpg = new Uint8Array(await (await toBlobP(c, "image/jpeg", q)).arrayBuffer());
    dec.src.close?.(); if (dec.src.width && !dec.src.close) dec.src.width = 1;
    if (jpg.length < obj.contents.length * 0.97) { replaceImage(doc, ref, obj, jpg, c.width, c.height); changed++; }
    c.width = c.height = 1;
    if (i % 3 === 2) await nextFrame();
  }
  return { bytes: await doc.save({ useObjectStreams: true }), changed, images: list.length };
}
/* صفحات كصور (أقصى ضغط، النص يصبح غير قابل للتحديد) */
const RASTER_LEVELS = [[150, 0.72], [130, 0.64], [110, 0.58], [96, 0.52], [84, 0.46], [72, 0.4]];
async function pdfRaster(bytes, [dpi, q], prog) {
  const src = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const out = await PDFDocument.create();
  for (let i = 1; i <= src.numPages; i++) {
    prog?.(`الصفحة ${i} من ${src.numPages}`);
    const page = await src.getPage(i); const vp1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: dpi / 72 });
    const c = cnv(Math.ceil(vp.width), Math.ceil(vp.height)); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp }).promise;
    const img = await out.embedJpg(new Uint8Array(await (await toBlobP(c, "image/jpeg", q)).arrayBuffer()));
    const pg = out.addPage([vp1.width, vp1.height]); pg.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    c.width = c.height = 1;
  }
  src.destroy();
  return await out.save({ useObjectStreams: true });
}
/* بحث ثنائي: أفضل مستوى (أقل رقم) يحقق الحجم المستهدف */
async function bestLevel(levels, target, run, prog) {
  const cache = new Map();
  const at = async i => { if (!cache.has(i)) { prog?.(`مستوى ${i + 1} من ${levels.length}`); cache.set(i, await run(levels[i])); } return cache.get(i); };
  const first = await at(0); if (first.size <= target) return { ...first, level: 0 };
  const last = await at(levels.length - 1); if (last.size > target) return { ...last, level: levels.length - 1, miss: true };
  let lo = 0, hi = levels.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((await at(m)).size <= target) hi = m; else lo = m; }
  return { ...(await at(hi)), level: hi };
}
async function pdfCompress(bytes, o, prog) {
  if (!o.target) {   // جودة يدوية: نختار المستوى من شريط الجودة
    const i = Math.round((1 - (o.quality ?? 0.7)) * (PDF_LEVELS.length - 1) / 0.85);
    const r = await pdfAtLevel(bytes, PDF_LEVELS[Math.max(0, Math.min(PDF_LEVELS.length - 1, i))], prog);
    return { bytes: r.bytes, info: r.images ? `${r.changed} صورة أعيد ضغطها` : "لا توجد صور — النصوص مضغوطة أصلاً" };
  }
  let imagesFound = 0;
  const r = await bestLevel(PDF_LEVELS, o.target, async L => { const x = await pdfAtLevel(bytes, L, prog); imagesFound = x.images; return { size: x.bytes.length, bytes: x.bytes, changed: x.changed }; }, prog);
  if (!r.miss) return { bytes: r.bytes, info: `ضغط الصور: مستوى ${r.level + 1} من ${PDF_LEVELS.length}` };
  if (o.raster) {
    prog?.("تحويل الصفحات إلى صور مضغوطة...");
    const rr = await bestLevel(RASTER_LEVELS, o.target, async L => { const b = await pdfRaster(bytes, L, prog); return { size: b.length, bytes: b }; }, prog);
    const better = rr.size < r.size ? rr : r;
    return { bytes: better.bytes, info: better === rr ? `الصفحات صور بدقة ${RASTER_LEVELS[rr.level][0]} DPI` : "أقصى ضغط للصور", miss: better.size > o.target };
  }
  return { bytes: r.bytes, info: imagesFound ? "أقصى ضغط للصور — فعّل «تحويل الصفحات إلى صور» لحجم أصغر" : "الملف نصوص بلا صور — فعّل «تحويل الصفحات إلى صور» لحجم أصغر", miss: true };
}
async function pdfEnhance(bytes, o, prog) {
  const probe = await loadPdfDoc(bytes);
  const n = pdfImageList(probe).length;
  if (!n) throw new Error("لا توجد صور داخل هذا الملف — نصوص PDF واضحة أصلاً بأي تكبير، فلا حاجة لتحسينها");
  const factors = [6, 4, 3, 2.5, 2, 1.6, 1.3, 1].filter(f => f <= (o.maxScale || 4));
  let best = null;
  for (const f of factors) {
    prog?.(`تكبير الصور ×${f}...`);
    const doc = await loadPdfDoc(bytes); const list = pdfImageList(doc); let changed = 0;
    for (let i = 0; i < list.length; i++) {
      const { ref, obj } = list[i]; prog?.(`×${f} — صورة ${i + 1} من ${list.length}`);
      const dec = await pdfImgDecode(obj, doc.context); if (!dec) continue;
      const cap = Math.min(f, Math.sqrt(16e6 / (dec.w * dec.h)), 6000 / Math.max(dec.w, dec.h));
      const s = Math.max(1, cap);
      const c = enhanceCanvas(dec.src, s, o);
      const jpg = new Uint8Array(await (await toBlobP(c, "image/jpeg", 0.92)).arrayBuffer());
      replaceImage(doc, ref, obj, jpg, c.width, c.height); changed++;
      c.width = c.height = 1; dec.src.close?.();
      await nextFrame();
    }
    if (!changed) throw new Error("صور هذا الملف بصيغة لا يمكن تحسينها في الهاتف");
    const out = await doc.save({ useObjectStreams: true });
    best = { bytes: out, info: `${changed} صورة كُبّرت ×${f} مع زيادة الوضوح` };
    if (out.length <= o.target) return best;
  }
  return { ...best, miss: true };
}

/* ═════════════════════════ Word / Excel / PowerPoint ═════════════════════════ */
const OFFICE_ZIP = ["docx", "docm", "dotx", "xlsx", "xlsm", "xltx", "pptx", "pptm", "ppsx", "potx", "odt", "ods", "odp", "epub"];
async function officeMedia(buf) {
  const z = await JSZip.loadAsync(buf);
  const media = Object.keys(z.files).filter(n => /^(word|ppt|xl)\/media\/[^/]+\.(jpe?g|png)$/i.test(n) || /^Pictures\/[^/]+\.(jpe?g|png)$/i.test(n) || /\.(jpe?g|png)$/i.test(n) && /images?\//i.test(n));
  const orig = {}; for (const m of media) orig[m] = await z.file(m).async("uint8array");
  return { z, media, orig };
}
async function officeGen(z) { return new Uint8Array(await z.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } })); }
async function officeCompress(buf, o, prog) {
  const { z, media, orig } = await officeMedia(buf);
  const run = async ([maxSide, q]) => {
    for (let i = 0; i < media.length; i++) {
      const m = media[i]; prog?.(`صورة ${i + 1} من ${media.length}`);
      const png = /\.png$/i.test(m); let out = orig[m];
      try {
        const src = await decodeImg(new Blob([orig[m]])); const W = wOf(src), H = hOf(src); const s = Math.min(1, maxSide / Math.max(W, H));
        if (!(png && s >= 1) && W * H > 96 * 96) {
          const c = resample(src, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)), png ? {} : { bg: "#ffffff" });
          const b = new Uint8Array(await (await toBlobP(c, png ? "image/png" : "image/jpeg", q)).arrayBuffer());
          if (b.length < out.length) out = b;
          c.width = c.height = 1;
        }
        src.close?.();
      } catch (e) {}
      z.file(m, out);
    }
    const bytes = await officeGen(z); return { size: bytes.length, bytes };
  };
  if (!media.length) { const bytes = await officeGen(z); return { bytes, info: "لا توجد صور — أعيد ضغط المستند بأقصى ضغط", miss: o.target && bytes.length > o.target }; }
  if (!o.target) { const i = Math.round((1 - (o.quality ?? 0.7)) * (PDF_LEVELS.length - 1) / 0.85); const r = await run(PDF_LEVELS[Math.max(0, Math.min(PDF_LEVELS.length - 1, i))]); return { bytes: r.bytes, info: `${media.length} صورة أعيد ضغطها` }; }
  const r = await bestLevel(PDF_LEVELS, o.target, run, prog);
  return { bytes: r.bytes, info: `${media.length} صورة — مستوى ${r.level + 1} من ${PDF_LEVELS.length}`, miss: r.miss };
}
async function officeEnhance(buf, o, prog) {
  const { z, media, orig } = await officeMedia(buf);
  if (!media.length) throw new Error("لا توجد صور داخل هذا المستند — النصوص واضحة أصلاً، فلا حاجة لتحسينها");
  const factors = [6, 4, 3, 2.5, 2, 1.6, 1.3, 1].filter(f => f <= (o.maxScale || 4));
  let best = null;
  for (const f of factors) {
    for (let i = 0; i < media.length; i++) {
      const m = media[i]; prog?.(`×${f} — صورة ${i + 1} من ${media.length}`);
      try {
        const src = await decodeImg(new Blob([orig[m]])); const W = wOf(src), H = hOf(src);
        const s = Math.max(1, Math.min(f, Math.sqrt(16e6 / (W * H)), 6000 / Math.max(W, H)));
        const png = /\.png$/i.test(m);
        const c = enhanceCanvas(src, s, o);
        z.file(m, new Uint8Array(await (await toBlobP(c, png ? "image/png" : "image/jpeg", 0.92)).arrayBuffer()));
        c.width = c.height = 1; src.close?.();
      } catch (e) { z.file(m, orig[m]); }
      await nextFrame();
    }
    const bytes = await officeGen(z);
    best = { bytes, info: `${media.length} صورة كُبّرت ×${f} مع زيادة الوضوح` };
    if (bytes.length <= o.target) return best;
  }
  return { ...best, miss: true };
}

/* ═════════════════════════ المعالجة الموحدة لأي ملف ═════════════════════════ */
const IMG_EXT = ["jpg", "jpeg", "png", "webp", "bmp", "gif", "jfif", "avif"];
const MEDIA_EXT = ["mp4", "mkv", "mov", "avi", "3gp", "webm", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "amr"];
function sizeKind(name, type = "") {
  const e = extOf(name);
  if (e === "pdf") return "pdf";
  if (IMG_EXT.includes(e) || (type.startsWith("image/") && e !== "svg" && e !== "heic")) return "image";
  if (OFFICE_ZIP.includes(e)) return "office";
  if (arcType(name)) return "archive";
  if (MEDIA_EXT.includes(e) || type.startsWith("video/") || type.startsWith("audio/")) return "media";
  return "other";
}
async function sizeProcess(file, opts, prog) {
  const kind = sizeKind(file.name, file.type), before = file.size, base = baseName(file.name), ext = extOf(file.name);
  const mode = opts.mode, suffix = mode === "compress" ? "_مضغوط" : "_محسّن";
  let blob, outExt = ext, info = "", miss = false;
  if (kind === "media") throw new Error("ملفات الفيديو والصوت غير مدعومة هنا — استخدم برنامج NEW LIFE على الكمبيوتر");
  if (kind === "archive") {
    if (mode === "enhance") throw new Error("ملف مضغوط — افتحه في «مدير الأرشيف» لفك ضغطه");
    throw new Error("الملف مضغوط أصلاً — استخدم «مدير الأرشيف» لإعادة ضغطه أو فكه");
  }
  if (kind === "image") {
    const r = mode === "compress" ? await imgCompress(file, opts, prog) : await imgEnhance(file, opts, prog);
    blob = r.blob; outExt = r.ext; info = r.info;
  } else if (kind === "pdf") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = mode === "compress" ? await pdfCompress(bytes, opts, prog) : await pdfEnhance(bytes, opts, prog);
    blob = new Blob([r.bytes], { type: "application/pdf" }); info = r.info; miss = !!r.miss;
  } else if (kind === "office") {
    const buf = await file.arrayBuffer();
    if (isCfb(buf)) throw new Error("المستند محمي بكلمة مرور — افتحه في NEW LIFE واحفظه بدون كلمة مرور أولاً");
    const r = mode === "compress" ? await officeCompress(buf, opts, prog) : await officeEnhance(buf, opts, prog);
    blob = new Blob([r.bytes], { type: mimeOf(file.name) }); info = r.info; miss = !!r.miss;
  } else {
    if (mode === "enhance") throw new Error("التكبير وتحسين الجودة للصور وPDF والمستندات التي فيها صور");
    const z = await zipLib(); const w = new z.ZipWriter(new z.BlobWriter("application/zip"));
    await w.add(file.name, new z.BlobReader(file), { level: 9, lastModDate: new Date(file.lastModified || Date.now()) });
    blob = await w.close(); outExt = "zip"; info = "ضُغط داخل ملف ZIP (يُفك بأي هاتف أو كمبيوتر)";
  }
  if (mode === "compress" && blob.size >= before && kind !== "other") { info = "الملف مضغوط أصلاً — لم يمكن تصغيره أكثر"; blob = file; outExt = ext; }
  if (opts.target && blob.size > opts.target) miss = true;
  return { blob, name: base + suffix + "." + outExt, before, after: blob.size, info, miss, kind };
}

/* ═════════════════════════ واجهة: الحجم والجودة ═════════════════════════ */
const SZ = { files: [], mode: "compress", target: MB, etarget: 5 * MB, qmode: "target", quality: 70, fmt: "auto", raster: false, level: 4, sharpen: true, denoise: false, color: true, results: [], running: false };
const SCALES = { 1: 1.5, 2: 2, 3: 3, 4: 4, 5: 6 };
function overlay(id, title) {
  let ov = document.getElementById(id);
  if (!ov) {
    ov = document.createElement("div"); ov.id = id; ov.className = "nlov"; ov.hidden = true;
    ov.innerHTML = `<header><button class="ibtn" data-x aria-label="رجوع">→</button><div class="ttl"></div><span class="hx"></span></header><div class="bar" hidden></div><div class="body"></div>`;
    document.body.append(ov);
    ov.querySelector("[data-x]").onclick = () => closeOverlay(ov);
  }
  ov.querySelector(".ttl").textContent = title; ov.hidden = false; return ov;
}
async function closeOverlay(ov) {
  if (ov.id === "arcOv" && ARC.dirty && !await confirmSheet("تعديلات غير محفوظة", "عدّلت الأرشيف ولم تحفظه. الخروج بدون حفظ؟", "خروج بدون حفظ", true)) return;
  ov.hidden = true;
}
function sizeOpen(files, mode) {
  if (mode) SZ.mode = mode;
  if (files) for (const f of files) if (!SZ.files.some(x => x.name === f.name && x.size === f.size)) SZ.files.push(f);
  overlay("szOv", "🗜 الحجم والجودة"); sizeRender();
}
function sizeRender() {
  const ov = document.getElementById("szOv"), b = ov.querySelector(".body");
  const isC = SZ.mode === "compress";
  const chipsC = [[100 * 1024, "100 KB"], [200 * 1024, "200 KB"], [500 * 1024, "500 KB"], [MB, "1 MB"], [2 * MB, "2 MB"]];
  const chipsE = [[2 * MB, "2 MB"], [3 * MB, "3 MB"], [5 * MB, "5 MB"], [8 * MB, "8 MB"]];
  const t = isC ? SZ.target : SZ.etarget, chips = isC ? chipsC : chipsE;
  const custom = !chips.some(c => c[0] === t);
  b.innerHTML = `
  <div class="segm"><button data-m="compress" class="${isC ? "on" : ""}">🗜 تصغير الحجم</button><button data-m="enhance" class="${!isC ? "on" : ""}">✨ تكبير وتحسين الجودة</button></div>
  <section class="card"><div class="row2"><strong>الملفات (${SZ.files.length})</strong><span class="grow"></span>
    <button class="btn sm" data-sz="add">➕ إضافة ملفات</button>${S.bytes && !S.sample ? '<button class="btn sm" data-sz="cur">📄 الملف المفتوح</button>' : ""}</div>
    <div class="flist">${SZ.files.length ? SZ.files.map((f, i) => `<div class="fi"><span class="ic">${kindIcon(sizeKind(f.name, f.type))}</span><span class="nm"><strong dir="auto">${h(f.name)}</strong><small>${hs(f.size)}</small></span><button class="ibtn" data-rm="${i}" aria-label="إزالة">✕</button></div>`).join("") : '<p class="lead" style="padding:8px 0">اختر صوراً أو ملفات PDF أو Word أو Excel أو PowerPoint أو نصوصاً.</p>'}</div></section>
  <section class="card">
    <strong>${isC ? "الحجم المطلوب (أقصى حد)" : "الحجم المطلوب (حتى)"}</strong>
    ${isC ? `<div class="segm sm"><button data-q="target" class="${SZ.qmode === "target" ? "on" : ""}">حجم محدد</button><button data-q="manual" class="${SZ.qmode === "manual" ? "on" : ""}">جودة يدوية</button></div>` : ""}
    ${!isC || SZ.qmode === "target" ? `<div class="chips">${chips.map(([v, l]) => `<button data-t="${v}" class="${v === t ? "on" : ""}">${l}</button>`).join("")}<button data-t="custom" class="${custom ? "on" : ""}">${custom ? hs(t) : "مخصص..."}</button></div>`
      : `<label class="field"><span>الجودة: <b id="qv">${SZ.quality}%</b> — أقل = حجم أصغر</span><input type="range" min="10" max="100" step="5" value="${SZ.quality}" id="qr"></label>`}
    ${isC ? `<label class="field"><span>صيغة الصور الناتجة</span><select id="fmtSel">${[["auto", "تلقائي (JPG، أو WEBP للصور الشفافة)"], ["jpg", "JPG"], ["webp", "WEBP (أصغر)"], ["png", "PNG (بدون فقد، تصغير الأبعاد فقط)"]].map(([k, l]) => `<option value="${k}" ${SZ.fmt === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="ck"><input type="checkbox" id="rasterCk" ${SZ.raster ? "checked" : ""}><span>PDF: السماح بتحويل الصفحات إلى صور عند الحاجة لحجم أصغر <small>(النص لن يُحدد أو يُنسخ)</small></span></label>`
      : `<label class="field"><span>مقدار التكبير: <b id="lv">×${SCALES[SZ.level]}</b> كحد أقصى</span><input type="range" min="1" max="5" step="1" value="${SZ.level}" id="lr"></label>
      <label class="ck"><input type="checkbox" id="shCk" ${SZ.sharpen ? "checked" : ""}><span>زيادة الحدة والوضوح</span></label>
      <label class="ck"><input type="checkbox" id="dnCk" ${SZ.denoise ? "checked" : ""}><span>إزالة التشويش (للصور المحببة أو الممسوحة)</span></label>
      <label class="ck"><input type="checkbox" id="coCk" ${SZ.color ? "checked" : ""}><span>تحسين الألوان والتباين</span></label>`}
  </section>
  <button class="btn primary big1" data-sz="go" ${SZ.files.length && !SZ.running ? "" : "disabled"}>${isC ? "🗜 تصغير الحجم الآن" : "✨ تكبير وتحسين الآن"}</button>
  <div id="szRes">${resultsHtml()}</div>`;
  b.querySelectorAll("[data-m]").forEach(x => x.onclick = () => { SZ.mode = x.dataset.m; sizeRender(); });
  b.querySelectorAll("[data-q]").forEach(x => x.onclick = () => { SZ.qmode = x.dataset.q; sizeRender(); });
  b.querySelectorAll("[data-rm]").forEach(x => x.onclick = () => { SZ.files.splice(+x.dataset.rm, 1); sizeRender(); });
  b.querySelectorAll("[data-t]").forEach(x => x.onclick = async () => {
    let v = x.dataset.t;
    if (v === "custom") { const s = await askText("حجم مخصص", "الحجم بالميجابايت (مثل 0.3 أو 1.5)", String(+(t / MB).toFixed(2))); const n = parseFloat(String(s || "").replace(",", ".")); if (!n || n <= 0) return; v = Math.round(n * MB); }
    if (isC) SZ.target = +v; else SZ.etarget = +v; sizeRender();
  });
  const qr = b.querySelector("#qr"); if (qr) qr.oninput = () => { SZ.quality = +qr.value; b.querySelector("#qv").textContent = qr.value + "%"; };
  const lr = b.querySelector("#lr"); if (lr) lr.oninput = () => { SZ.level = +lr.value; b.querySelector("#lv").textContent = "×" + SCALES[SZ.level]; };
  const bind = (id, k) => { const e = b.querySelector(id); if (e) e.onchange = () => SZ[k] = e.type === "checkbox" ? e.checked : e.value; };
  bind("#fmtSel", "fmt"); bind("#rasterCk", "raster"); bind("#shCk", "sharpen"); bind("#dnCk", "denoise"); bind("#coCk", "color");
  b.querySelector('[data-sz="add"]').onclick = async () => { const fs = await pickFiles(fileInput("szIn", true)); if (fs.length) { sizeOpen(fs); } };
  const cur = b.querySelector('[data-sz="cur"]'); if (cur) cur.onclick = () => sizeOpen([new File([S.bytes], baseName(S.name) + ".pdf", { type: "application/pdf" })]);
  b.querySelector('[data-sz="go"]').onclick = sizeRun;
  bindResults(b);
}
function kindIcon(k) { return { pdf: "📕", image: "🖼", office: "📘", archive: "🗜", media: "🎬", other: "📄" }[k] || "📄"; }
function resultsHtml() {
  if (!SZ.results.length) return "";
  const ok = SZ.results.filter(r => r.blob);
  return `<section class="card"><div class="row2"><strong>النتائج</strong><span class="grow"></span>${ok.length > 1 ? '<button class="btn sm primary" data-r="all">💾 حفظ الكل في مجلد</button>' : ""}</div>
  ${SZ.results.map((r, i) => r.blob ? `<div class="res">
    <div class="row2"><span class="ic">${kindIcon(r.kind)}</span><span class="nm"><strong dir="auto">${h(r.name)}</strong>
    <small>${hs(r.before)} ← <b class="${r.miss ? "warn" : "good"}">${hs(r.after)}</b> ${r.before ? `(${r.after <= r.before ? "−" : "+"}${Math.abs(Math.round((1 - r.after / r.before) * 100))}%)` : ""}</small>
    <small>${h(r.info)}${r.miss ? " — لم يصل للحجم المطلوب تماماً" : ""}</small></span></div>
    <div class="row2 acts2"><button class="btn sm" data-r="save" data-i="${i}">💾 حفظ</button><button class="btn sm" data-r="share" data-i="${i}">↗ مشاركة</button><button class="btn sm" data-r="open" data-i="${i}">👁 فتح</button></div></div>`
    : `<div class="res err"><strong dir="auto">${h(r.src)}</strong><small>${h(r.error)}</small></div>`).join("")}</section>`;
}
function bindResults(b) {
  b.querySelectorAll("[data-r]").forEach(x => x.onclick = async () => {
    const r = SZ.results[+x.dataset.i], a = x.dataset.r;
    if (a === "save") saveFile(r.name, r.blob);
    if (a === "share") shareFile(r.name, r.blob);
    if (a === "open") { document.getElementById("szOv").hidden = true; openAnyFile(new File([r.blob], r.name, { type: mimeOf(r.name) })); }
    if (a === "all") saveManyToFolder(SZ.results.filter(r => r.blob).map(r => ({ path: r.name, blob: r.blob })), "");
  });
}
let _inputs = {};
function fileInput(id, multiple, accept = "") {
  if (!_inputs[id]) { const i = document.createElement("input"); i.type = "file"; i.className = "sr"; i.id = id; i.style.display = "none"; if (multiple) i.multiple = true; if (accept) i.accept = accept; document.body.append(i); _inputs[id] = i; }
  return _inputs[id];
}
async function sizeRun() {
  if (SZ.running || !SZ.files.length) return;
  SZ.running = true; SZ.results = [];
  const opts = SZ.mode === "compress"
    ? { mode: "compress", target: SZ.qmode === "target" ? SZ.target : null, quality: SZ.quality / 100, fmt: SZ.fmt, raster: SZ.raster }
    : { mode: "enhance", target: SZ.etarget, maxScale: SCALES[SZ.level], sharpen: SZ.sharpen, denoise: SZ.denoise, color: SZ.color };
  try {
    for (let i = 0; i < SZ.files.length; i++) {
      const f = SZ.files[i]; const pre = `(${i + 1}/${SZ.files.length}) ${f.name}`;
      busy(pre); await nextFrame();
      try { SZ.results.push(await sizeProcess(f, opts, m => busy(pre + "\n" + m))); }
      catch (e) { console.error(e); SZ.results.push({ src: f.name, error: e.message || String(e) }); }
    }
  } finally { busy(); SZ.running = false; }
  sizeRender();
  document.querySelector("#szOv .body #szRes")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ═════════════════════════ محرك الأرشيف ═════════════════════════ */
function arcType(name) {
  const n = String(name || "").toLowerCase();
  if (/\.(zip|cbz|zipx)$/.test(n)) return "zip";
  if (/\.(7z|cb7|rar|cbr|tar|tgz|tbz2?|txz|tlz|gz|bz2|xz|lzma|lz|iso|cab|lzh|lha|arj|cpio|z|xar|ar)$/.test(n)) return "la";
  return null;
}
async function arcSniff(file) {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5)) return "zip";
  if ((b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc) || (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) || (b[0] === 0x1f && b[1] === 0x8b) || (b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a) || (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68)) return "la";
  return null;
}
const normPath = p => String(p || "").replace(/\\/g, "/").replace(/^\.?\/+/, "").split("/").filter(s => s && s !== "." && s !== "..").join("/");
function zipEntryName(e) {
  if (e.filenameUTF8 || !e.rawFilename) return e.filename;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(e.rawFilename); } catch (x) {}
  try { const t = new TextDecoder("windows-1256").decode(e.rawFilename); if (AR.test(t)) return t; } catch (x) {}
  return e.filename;
}
async function arcOpenFile(file, password) {
  const t = arcType(file.name) || await arcSniff(file);
  if (!t) throw new Error("هذا الملف ليس أرشيفاً مضغوطاً معروفاً");
  const A = { file, name: file.name, kind: t, password: password || null, entries: [], encrypted: false };
  if (t === "zip") {
    const z = await zipLib();
    const reader = new z.ZipReader(new z.BlobReader(file));
    let ents;
    try { ents = await reader.getEntries(); } catch (e) { if (/zip/i.test(e.message)) throw new Error("الملف تالف أو ليس ZIP صحيحاً"); throw e; }
    A.entries = ents.map(e => ({ path: normPath(zipEntryName(e)), dir: !!e.directory, size: e.uncompressedSize, packed: e.compressedSize, date: e.lastModDate, enc: !!e.encrypted, ref: e })).filter(e => e.path);
    A.encrypted = A.entries.some(e => e.enc);
  } else {
    const { Archive } = await laLib();
    const a = await Archive.open(file);
    let enc = null; try { enc = await a.hasEncryptedData(); } catch (e) {}
    if (enc === true) { a.close?.(); throw new Error(ENC_UNSUP); }
    let arr;
    try { arr = await a.getFilesArray(); } catch (e) { a.close?.(); e = laErr(e); if (e.message === ENC_UNSUP) throw e; throw new Error("تعذر قراءة الأرشيف: " + (e.message || e)); }
    if (!arr.length && enc !== false) { a.close?.(); throw new Error("الأرشيف فارغ أو تالف أو صيغته غير مدعومة"); }
    A.la = a; A.encrypted = !!enc;
    A.entries = arr.map(x => ({ path: normPath((x.path || "") + x.file.name), dir: false, size: x.file.size, packed: null, date: null, enc: !!enc, ref: x.file })).filter(e => e.path);
  }
  return A;
}
/* استخراج ملف واحد ← Blob */
async function arcGet(A, ent) {
  if (A.kind === "zip") {
    const z = await zipLib();
    try { return await ent.ref.getData(new z.BlobWriter(mimeOf(ent.path)), { password: A.password || undefined, checkSignature: true }); }
    catch (e) { if (/encrypted entry|Invalid password|password/i.test(e.message)) throw pwErr(); throw e; }
  }
  try { return await ent.ref.extract(); }
  catch (e) {
    if (/closed/i.test(e.message || "")) { const B = await arcOpenFile(A.file, A.password); A.la = B.la; A.entries = B.entries; const e2 = A.entries.find(x => x.path === ent.path); if (e2) return await e2.ref.extract(); }
    throw laErr(e);
  }
}
/* استخراج مجموعة ملفات: onEach(path, blob) */
async function arcExtractEach(A, paths, onEach, prog) {
  const want = paths ? (p => paths.some(s => p === s || p.startsWith(s + "/"))) : (() => true);
  const list = A.entries.filter(e => !e.dir && want(e.path));
  if (A.kind === "zip" || list.length <= 3) {
    for (let i = 0; i < list.length; i++) { prog?.(`(${i + 1}/${list.length}) ${list[i].path}`); await onEach(list[i].path, await arcGet(A, list[i])); }
    return list.length;
  }
  // libarchive: فك الكل دفعة واحدة (أسرع)
  const { Archive } = await laLib(); const a = await Archive.open(A.file);
  if (A.password) await a.usePassword(A.password);
  prog?.("جاري فك الضغط...");
  try { await a.extractFiles(); } catch (e) { throw laErr(e); }
  const arr = await a.getFilesArray(); let n = 0;
  const set = new Set(list.map(e => e.path));
  for (const x of arr) {
    const p = normPath((x.path || "") + x.file.name); if (!set.has(p)) continue;
    n++; prog?.(`(${n}/${set.size}) ${p}`); await onEach(p, x.file);
  }
  return n;
}
async function arcTest(A, prog) {
  let n = 0;
  await arcExtractEach(A, null, async () => { n++; }, prog);
  return n;
}
const NOCOMP = /\.(jpe?g|png|gif|webp|heic|mp4|mkv|mov|avi|mp3|m4a|aac|ogg|opus|zip|7z|rar|gz|xz|bz2|docx|xlsx|pptx|apk)$/i;
/* إنشاء ZIP: items [{path, file|url, dir, date}] */
async function zipCreate(items, { password, level = 6 } = {}, prog) {
  const z = await zipLib();
  const w = new z.ZipWriter(new z.BlobWriter("application/zip"), password ? { password, encryptionStrength: 3, zipCrypto: false } : {});
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; let p = normPath(it.path); if (!p) continue;
    if (it.dir) { if (seen.has(p + "/")) continue; seen.add(p + "/"); await w.add(p + "/", null, { directory: true, lastModDate: it.date || new Date() }); continue; }
    while (seen.has(p)) p = p.replace(/(\.[^./]+)?$/, m => " (2)" + m);
    seen.add(p);
    prog?.(`(${i + 1}/${items.length}) ${p}`);
    const blob = await itemBlob(it);
    await w.add(p, new z.BlobReader(blob), { level: level === 0 || NOCOMP.test(p) ? 0 : level, lastModDate: it.date || new Date(blob.lastModified || Date.now()) });
  }
  return await w.close();
}
async function tgzCreate(items, prog) {
  const { Archive, ArchiveFormat, ArchiveCompression } = await laLib();
  const files = [];
  for (const it of items) { if (it.dir) continue; prog?.(it.path); files.push({ file: await itemBlob(it), pathname: normPath(it.path) }); }
  if (!files.length) throw new Error("لا توجد ملفات");
  prog?.("جاري إنشاء TAR.GZ...");
  return await Archive.write({ files, outputFileName: "archive.tar.gz", compression: ArchiveCompression.GZIP, format: ArchiveFormat.PAX, passphrase: null });
}
/* تعديل ZIP: حذف / إعادة تسمية / إضافة ثم إعادة الكتابة */
async function zipRewrite(A, { drop = [], rename = null, add = [] } = {}, prog) {
  if (A.kind !== "zip") throw new Error("التعديل متاح لملفات ZIP فقط");
  if (A.encrypted && !A.password) throw pwErr();
  const z = await zipLib();
  const w = new z.ZipWriter(new z.BlobWriter("application/zip"), A.password ? { password: A.password, encryptionStrength: 3 } : {});
  const isDropped = p => drop.some(d => p === d || p.startsWith(d + "/"));
  const ren = p => rename && (p === rename.from || p.startsWith(rename.from + "/")) ? rename.to + p.slice(rename.from.length) : p;
  const addSet = new Set(add.map(a => normPath(a.path)));
  const list = A.entries.filter(e => !isDropped(e.path));
  for (let i = 0; i < list.length; i++) {
    const e = list[i], p = ren(e.path); if (addSet.has(p)) continue;
    prog?.(`(${i + 1}/${list.length}) ${p}`);
    if (e.dir) { await w.add(p + "/", null, { directory: true, lastModDate: e.date || new Date() }); continue; }
    const data = await arcGet(A, e);
    await w.add(p, new z.BlobReader(data), { lastModDate: e.date || new Date(), level: NOCOMP.test(p) ? 0 : 6 });
  }
  for (const it of add) {
    const p = normPath(it.path); prog?.(p);
    if (it.dir) { await w.add(p + "/", null, { directory: true, lastModDate: new Date() }); continue; }
    const blob = await itemBlob(it);
    await w.add(p, new z.BlobReader(blob), { lastModDate: it.date || new Date(), level: NOCOMP.test(p) ? 0 : 6 });
  }
  const out = await w.close();
  return new File([out], A.name, { type: "application/zip" });
}

/* ═════════════════════════ واجهة: مدير الأرشيف ═════════════════════════ */
const ARC = { A: null, cwd: "", sel: new Set(), q: "", dirty: false };
function arcTree(A) {   // {dirs: Map(path -> {files:[], dirs:Set})}
  const dirs = new Map([["", { files: [], dirs: new Set() }]]);
  const ensure = p => {
    if (dirs.has(p)) return dirs.get(p);
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    ensure(parent).dirs.add(p); const d = { files: [], dirs: new Set() }; dirs.set(p, d); return d;
  };
  for (const e of A.entries) {
    if (e.dir) { ensure(e.path); continue; }
    const parent = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "";
    ensure(parent).files.push(e);
  }
  return dirs;
}
function dirSize(tree, p) { let s = 0; const d = tree.get(p); if (!d) return 0; for (const f of d.files) s += f.size || 0; for (const c of d.dirs) s += dirSize(tree, c); return s; }
function fileIcon(p) {
  const e = extOf(p);
  if (e === "pdf") return "📕"; if (IMG_EXT.includes(e) || e === "heic" || e === "svg") return "🖼";
  if (["doc", "docx", "odt", "rtf"].includes(e)) return "📘"; if (["xls", "xlsx", "csv", "ods"].includes(e)) return "📗"; if (["ppt", "pptx", "odp"].includes(e)) return "📙";
  if (MEDIA_EXT.includes(e)) return "🎬"; if (arcType(p)) return "🗜"; if (["txt", "md", "json", "xml", "html", "log"].includes(e)) return "📝"; return "📄";
}
function arcOpenUi() {
  const ov = overlay("arcOv", ARC.A ? "🗂 " + ARC.A.name : "🗂 مدير الأرشيف");
  arcRender(); return ov;
}
async function arcLoad(file, password) {
  busy("جاري فتح الأرشيف...");
  try {
    const A = await arcOpenFile(file, password);
    if (ARC.A?.la && ARC.A.la !== A.la) ARC.A.la.close?.();
    ARC.A = A; ARC.cwd = ""; ARC.sel.clear(); ARC.q = ""; ARC.dirty = false;
    // مجلد جذر واحد: ندخله مباشرة
    const tree = arcTree(A), root = tree.get("");
    if (root.files.length === 0 && root.dirs.size === 1) ARC.cwd = [...root.dirs][0];
    arcOpenUi();
  } catch (e) {
    busy();
    if (e.pw) { const pw = await askPw("الأرشيف محمي بكلمة مرور", password ? "كلمة المرور غير صحيحة. حاول مرة أخرى:" : `«${file.name}» محمي. أدخل كلمة المرور لفتحه:`); if (pw) return arcLoad(file, pw); return; }
    toast("تعذر فتح الأرشيف: " + (e.message || e), 5000);
  } finally { busy(); }
}
async function withPw(fn) {   // تنفيذ عملية مع طلب كلمة المرور عند الحاجة
  for (let tries = 0; tries < 4; tries++) {
    try { return await fn(); }
    catch (e) {
      busy();
      if (!e.pw) throw e;
      const pw = await askPw("كلمة المرور", ARC.A.password ? "كلمة المرور غير صحيحة. حاول مرة أخرى:" : "هذا الأرشيف محمي. أدخل كلمة المرور:");
      if (!pw) return undefined;
      ARC.A.password = pw;
      if (ARC.A.kind === "la") { const B = await arcOpenFile(ARC.A.file, pw).catch(() => null); if (B) { ARC.A.la = B.la; ARC.A.entries = B.entries; } }
    }
  }
}
function arcRender() {
  const ov = document.getElementById("arcOv"); if (!ov) return;
  const A = ARC.A, bar = ov.querySelector(".bar"), b = ov.querySelector(".body");
  ov.querySelector(".ttl").textContent = A ? "🗂 " + A.name + (ARC.dirty ? " •" : "") : "🗂 مدير الأرشيف";
  const edit = A && A.kind === "zip", nsel = ARC.sel.size;
  bar.hidden = false;
  const B = (k, ic, t, dis) => `<button data-a="${k}" ${dis ? "disabled" : ""}><b>${ic}</b>${t}</button>`;
  bar.innerHTML = B("open", "📂", "فتح") + B("new", "🗜", "إنشاء") +
    (A ? B("xall", "📤", "استخراج الكل") + B("xsel", "📤", `المحدد${nsel ? ` (${nsel})` : ""}`, !nsel) + B("add", "➕", "إضافة", !edit) + B("mkdir", "📁", "مجلد جديد", !edit) +
      B("ren", "✏", "إعادة تسمية", !edit || nsel !== 1) + B("del", "🗑", "حذف", !edit || !nsel) + B("test", "✔", "فحص") + B("conv", "🔁", "تحويل إلى ZIP") + (ARC.dirty ? B("save", "💾", "حفظ الأرشيف") : "") + B("share", "↗", "مشاركة") : "");
  bar.querySelectorAll("[data-a]").forEach(x => x.onclick = () => arcAction(x.dataset.a));
  if (!A) {
    b.innerHTML = `<div class="arc-empty"><div style="font-size:54px">🗂</div><h2>مدير الأرشيف</h2>
      <p class="lead">افتح ملفاً مضغوطاً لتصفحه وفك ضغطه: ZIP و7Z وRAR وTAR وGZ وISO — حتى المحمية بكلمة مرور. أو أنشئ ملف ZIP من ملفاتك أو مجلد كامل.</p>
      <div class="big2"><button class="btn primary" data-a="open">📂 فتح أرشيف</button><button class="btn" data-a="new">🗜 إنشاء ZIP</button></div></div>`;
    b.querySelectorAll("[data-a]").forEach(x => x.onclick = () => arcAction(x.dataset.a));
    return;
  }
  const tree = arcTree(A); if (!tree.has(ARC.cwd)) ARC.cwd = "";
  const files = A.entries.filter(e => !e.dir), total = files.reduce((s, e) => s + (e.size || 0), 0), packed = files.reduce((s, e) => s + (e.packed || 0), 0);
  const info = `${files.length} ملف · ${tree.size - 1} مجلد · الحجم الأصلي ${hs(total)} · حجم الأرشيف ${hs(A.file.size)}${packed && total ? ` · ضغط ${Math.max(0, Math.round(100 - packed * 100 / total))}%` : ""}${A.encrypted ? " · 🔒 محمي" : ""}${A.kind !== "zip" ? " · (التعديل لملفات ZIP فقط)" : ""}`;
  let rows = [];
  if (ARC.q) {
    const q = ARC.q.toLowerCase();
    rows = A.entries.filter(e => e.path.toLowerCase().includes(q)).slice(0, 500).map(e => ({ dir: e.dir, path: e.path, label: e.path, e }));
  } else {
    const d = tree.get(ARC.cwd);
    rows = [...d.dirs].sort((a, b) => a.localeCompare(b, "ar")).map(p => ({ dir: true, path: p, label: p.split("/").pop() }))
      .concat(d.files.slice().sort((a, b) => a.path.localeCompare(b.path, "ar")).map(e => ({ dir: false, path: e.path, label: e.path.split("/").pop(), e })));
  }
  const crumbs = ARC.cwd ? ARC.cwd.split("/") : [];
  b.innerHTML = `<p class="arc-info">${h(info)}</p>
    <input type="search" id="arcQ" placeholder="🔍 بحث في أسماء الملفات..." value="${h(ARC.q)}" class="arc-q">
    ${ARC.q ? "" : `<div class="arc-crumbs"><button data-cd="">🏠 الجذر</button>${crumbs.map((c, i) => `<span>›</span><button data-cd="${h(crumbs.slice(0, i + 1).join("/"))}">${h(c)}</button>`).join("")}</div>`}
    <div class="arc-list">${rows.length ? rows.map(r => {
      const e = r.e, sub = r.dir ? `${hs(dirSize(tree, r.path))}` : `${hs(e.size)}${e.packed != null && e.size ? ` · ${Math.max(0, Math.round(100 - e.packed * 100 / e.size))}%` : ""}${e.date && !isNaN(e.date) ? " · " + e.date.toLocaleDateString("ar-EG-u-nu-latn") : ""}${e.enc ? " · 🔒" : ""}`;
      return `<div class="arc-row" data-p="${h(r.path)}" data-d="${r.dir ? 1 : 0}"><input type="checkbox" ${ARC.sel.has(r.path) ? "checked" : ""} aria-label="تحديد"><span class="ic">${r.dir ? "📁" : fileIcon(r.path)}</span><span class="nm"><strong dir="auto">${h(r.label)}</strong><small>${sub}</small></span><span class="go">${r.dir ? "‹" : "⋮"}</span></div>`;
    }).join("") : '<p class="lead" style="padding:14px">لا توجد ملفات هنا</p>'}</div>
    ${nsel ? `<div class="arc-selbar"><span>${nsel} محدد</span><button class="btn sm" data-a="xsel">📤 استخراج</button>${edit ? '<button class="btn sm" data-a="del">🗑 حذف</button>' : ""}<button class="btn sm" data-a="clr">✕</button></div>` : ""}`;
  const qi = b.querySelector("#arcQ"); qi.oninput = () => { ARC.q = qi.value; const pos = qi.selectionStart; arcRender(); const n = document.querySelector("#arcQ"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
  b.querySelectorAll("[data-cd]").forEach(x => x.onclick = () => { ARC.cwd = x.dataset.cd; arcRender(); });
  b.querySelectorAll(".arc-selbar [data-a]").forEach(x => x.onclick = () => arcAction(x.dataset.a));
  b.querySelectorAll(".arc-row").forEach(row => {
    const p = row.dataset.p, isDir = row.dataset.d === "1";
    row.querySelector("input").onclick = ev => { ev.stopPropagation(); if (ev.target.checked) ARC.sel.add(p); else ARC.sel.delete(p); arcRender(); };
    row.onclick = () => { if (isDir) { ARC.cwd = p; ARC.q = ""; arcRender(); } else arcFileMenu(A.entries.find(e => e.path === p)); };
  });
}
async function arcFileMenu(ent) {
  if (!ent) return;
  const k = await choose(ent.path.split("/").pop(), [["open", "👁 فتح في NEW LIFE", "عرض وتعديل الملف"], ["other", "📲 فتح بتطبيق آخر", "معرض الصور، مشغل الفيديو..."], ["save", "💾 حفظ في الهاتف", "اختر مكان الحفظ"], ["share", "↗ مشاركة", "واتساب، بريد..."], ...(ARC.A.kind === "zip" ? [["ren", "✏ إعادة تسمية", ""], ["del", "🗑 حذف من الأرشيف", ""]] : [])], `${hs(ent.size)}${ent.path.includes("/") ? " · " + ent.path : ""}`);
  if (!k) return;
  if (k === "ren" || k === "del") { ARC.sel = new Set([ent.path]); return arcAction(k); }
  busy("جاري الاستخراج...");
  const blob = await withPw(() => arcGet(ARC.A, ent)).catch(e => { toast("تعذر الاستخراج: " + e.message, 5000); return null; }).finally(() => busy());
  if (!blob) return;
  const name = ent.path.split("/").pop(), file = new File([blob], name, { type: mimeOf(name) });
  if (k === "open") { if (arcType(name)) { arcLoad(file); return; } document.getElementById("arcOv").hidden = true; openAnyFile(file); }
  if (k === "other") openWithOther(file);
  if (k === "save") saveFile(name, file);
  if (k === "share") shareFile(name, file);
}
async function arcExtractTo(paths) {
  const A = ARC.A; const n = A.entries.filter(e => !e.dir && (!paths || paths.some(s => e.path === s || e.path.startsWith(s + "/")))).length;
  if (!n) { toast("لا توجد ملفات للاستخراج"); return; }
  const k = await choose("فك الضغط", [["sub", `📁 في مجلد جديد «${baseName(A.name).replace(/\.tar$/i, "")}»`, "داخل المكان الذي تختاره (موصى به)"], ["here", "📂 في المجلد الذي أختاره مباشرة", "بدون مجلد جديد"], ...(n === 1 ? [["one", "💾 حفظ الملف فقط", "نافذة حفظ عادية"]] : [])], `${n} ملف — اختر مكان الحفظ في الهاتف`);
  if (!k) return;
  if (k === "one") { const e = A.entries.find(e => !e.dir && (!paths || paths.some(s => e.path === s || e.path.startsWith(s + "/")))); return arcFileMenuSave(e); }
  if (!NL || !NL.folderWrite) {   // خارج التطبيق: ZIP واحد بالملفات المحددة
    toast("الحفظ في مجلد يعمل داخل التطبيق"); return;
  }
  let r;
  try { r = JSON.parse(await native("folderOpen", [k === "sub" ? baseName(A.name).replace(/\.tar$/i, "") : ""])); }
  catch (e) { if (e.message !== "declined") toast("تعذر فتح المجلد: " + e.message); return; }
  const strip = paths && paths.length === 1 && A.entries.some(e => e.dir && e.path === paths[0]) ? "" : "";
  let count = 0;
  try {
    count = await withPw(() => { count = 0; return arcExtractEach(A, paths, async (p, blob) => {
      const rel = strip && p.startsWith(strip) ? p.slice(strip.length) : p;
      const tok = await putBlob(blob, extOf(p) || "bin"); const err = NL.folderWrite(r.id, rel, tok); if (err) throw new Error(err);
    }, m => busy("فك الضغط إلى «" + r.name + "»\n" + m)); });
    if (count !== undefined) toast(`✅ استُخرج ${count} ملف إلى «${r.name}»`, 5000);
  } catch (e) { toast("تعذر الاستخراج: " + e.message, 6000); }
  finally { busy(); try { NL.folderClose(r.id); } catch (e) {} }
}
async function arcFileMenuSave(e) {
  busy("جاري الاستخراج...");
  try { const b = await withPw(() => arcGet(ARC.A, e)); if (b) { busy(); await saveFile(e.path.split("/").pop(), b); } } catch (x) { toast(x.message); } finally { busy(); }
}
async function arcAddItems(items) {
  const A = ARC.A; const pre = ARC.cwd ? ARC.cwd + "/" : "";
  busy("جاري الإضافة...");
  try {
    const f = await withPw(() => zipRewrite(A, { add: items.map(it => ({ ...it, path: pre + it.path })) }, m => busy("جاري الإضافة\n" + m)));
    if (f) { await arcReplace(f); toast(`أضيف ${items.filter(i => !i.dir).length} ملف — اضغط «حفظ الأرشيف» للحفظ`, 4000); }
  } catch (e) { toast("تعذرت الإضافة: " + e.message, 5000); } finally { busy(); }
}
async function arcReplace(file) {
  const pw = ARC.A.password, cwd = ARC.cwd;
  const A = await arcOpenFile(file, pw); A.name = ARC.A.name; ARC.A = A; ARC.dirty = true; ARC.sel.clear();
  ARC.cwd = arcTree(A).has(cwd) ? cwd : ""; arcRender();
}
async function arcAction(a) {
  const A = ARC.A;
  if (a === "open") {
    if (ARC.dirty && !await confirmSheet("تعديلات غير محفوظة", "فتح أرشيف آخر بدون حفظ التعديلات؟", "متابعة", true)) return;
    const [f] = await pickFiles(fileInput("arcIn", false)); if (f) arcLoad(f); return;
  }
  if (a === "new") return createOpen();
  if (!A) return;
  if (a === "clr") { ARC.sel.clear(); arcRender(); return; }
  if (a === "xall") return arcExtractTo(null);
  if (a === "xsel") return arcExtractTo([...ARC.sel]);
  if (a === "add") {
    const k = await choose("إضافة إلى الأرشيف", [["files", "📄 ملفات", "من الهاتف"], ["folder", "📁 مجلد كامل", "بكل محتواه"]], ARC.cwd ? "داخل: " + ARC.cwd : "في جذر الأرشيف");
    if (k === "files") { const fs = await pickFiles(fileInput("arcAddIn", true)); if (fs.length) arcAddItems(fs.map(f => ({ path: f.name, file: f }))); }
    if (k === "folder") { const r = await pickFolderFiles(); if (r) arcAddItems(r.items); }
    return;
  }
  if (a === "mkdir") { const n = await askText("مجلد جديد", "اسم المجلد"); if (n) arcAddItems([{ path: n.replace(/[\\/]/g, "_"), dir: true }]); return; }
  if (a === "ren") {
    const p = [...ARC.sel][0]; if (!p) return;
    const old = p.split("/").pop(); const n = await askText("إعادة تسمية", "الاسم الجديد", old);
    if (!n || n === old || /[\\/]/.test(n)) return;
    const to = (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "") + n;
    if (A.entries.some(e => e.path === to)) { toast("يوجد ملف بهذا الاسم"); return; }
    busy("جاري إعادة التسمية...");
    try { const f = await withPw(() => zipRewrite(A, { rename: { from: p, to } }, m => busy("إعادة التسمية\n" + m))); if (f) await arcReplace(f); }
    catch (e) { toast(e.message); } finally { busy(); }
    return;
  }
  if (a === "del") {
    const ps = [...ARC.sel]; if (!ps.length) return;
    if (!await confirmSheet("حذف من الأرشيف", `حذف ${ps.length} عنصر من الأرشيف؟`, "حذف", true)) return;
    busy("جاري الحذف...");
    try { const f = await withPw(() => zipRewrite(A, { drop: ps }, m => busy("جاري الحذف\n" + m))); if (f) { await arcReplace(f); toast("تم الحذف — اضغط «حفظ الأرشيف» للحفظ", 4000); } }
    catch (e) { toast(e.message); } finally { busy(); }
    return;
  }
  if (a === "test") {
    busy("جاري الفحص...");
    try { const n = await withPw(() => arcTest(A, m => busy("فحص السلامة\n" + m))); if (n !== undefined) { busy(); await confirmSheet("✅ الأرشيف سليم", `تم فحص ${n} ملف بنجاح — لا توجد أخطاء.`, "حسناً"); } }
    catch (e) { busy(); await confirmSheet("❌ الأرشيف تالف", "تعذر قراءة بعض الملفات: " + (e.message || e), "حسناً", true); }
    finally { busy(); }
    return;
  }
  if (a === "conv") {
    const pw = await sheet((b, close) => {
      b.insertAdjacentHTML("beforeend", `<h2>تحويل إلى ZIP</h2><p class="lead">يُنشأ ملف ZIP جديد بنفس المحتوى (يفتح في أي جهاز). يمكنك حمايته بكلمة مرور.</p>
      <label class="field"><span>كلمة مرور (اختياري)</span><input type="password" id="cpw" style="border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-height:42px;background:var(--surface)"></label>
      <div class="acts"><button class="btn" data-v="0">إلغاء</button><button class="btn primary" data-v="1">تحويل</button></div>`);
      b.querySelector('[data-v="0"]').onclick = () => close(null); b.querySelector('[data-v="1"]').onclick = () => close({ pw: b.querySelector("#cpw").value });
    });
    if (!pw) return;
    busy("جاري التحويل...");
    try {
      const items = [];
      const n = await withPw(() => { items.length = 0; return arcExtractEach(A, null, async (p, blob) => items.push({ path: p, file: blob }), m => busy("قراءة\n" + m)); });
      if (n === undefined) return;
      const out = await zipCreate(items, { password: pw.pw || null }, m => busy("إنشاء ZIP\n" + m));
      const name = baseName(A.name).replace(/\.tar$/i, "") + ".zip"; busy();
      createResult(new File([out], name, { type: "application/zip" }), items.reduce((s, i) => s + i.file.size, 0));
    } catch (e) { toast("تعذر التحويل: " + e.message, 5000); } finally { busy(); }
    return;
  }
  if (a === "save") { if (await saveFile(A.name, A.file)) { ARC.dirty = false; arcRender(); } return; }
  if (a === "share") { shareFile(A.name, A.file); return; }
}

/* ───────── إنشاء أرشيف ───────── */
const CR = { items: [], fmt: "zip", level: 6, name: "" };
function createOpen(files) {
  if (files) for (const f of files) CR.items.push({ path: f.name, file: f, size: f.size });
  sheet((b, close) => {
    const render = () => {
      const files = CR.items.filter(i => !i.dir), total = files.reduce((s, i) => s + (i.size || i.file?.size || 0), 0);
      if (!CR.name && CR.items.length) CR.name = CR.items[0].path.split("/")[0].replace(/\.[^.]+$/, "") || "أرشيف";
      b.innerHTML = `<div class="grab"></div><h2>🗜 إنشاء أرشيف مضغوط</h2>
      <div class="row2"><button class="btn sm" data-c="files">📄 إضافة ملفات</button><button class="btn sm" data-c="folder">📁 إضافة مجلد</button><span class="grow"></span><small class="muted">${files.length} ملف · ${hs(total)}</small></div>
      <div class="flist" style="max-height:160px;overflow:auto">${CR.items.filter(i => !i.dir).slice(0, 200).map((it, i) => `<div class="fi"><span class="ic">${fileIcon(it.path)}</span><span class="nm"><strong dir="auto">${h(it.path)}</strong><small>${hs(it.size || it.file?.size)}</small></span><button class="ibtn" data-rm="${h(it.path)}">✕</button></div>`).join("") || '<p class="lead">أضف ملفات أو مجلداً كاملاً.</p>'}</div>
      <label class="field"><span>اسم الأرشيف</span><input type="text" id="crName" value="${h(CR.name)}"></label>
      <div class="segm"><button data-f="zip" class="${CR.fmt === "zip" ? "on" : ""}">ZIP (موصى به)</button><button data-f="tgz" class="${CR.fmt === "tgz" ? "on" : ""}">TAR.GZ</button></div>
      <label class="field"><span>مستوى الضغط</span><select id="crLv">${[[6, "عادي (موصى به)"], [9, "أقصى ضغط (أبطأ)"], [1, "سريع"], [0, "تخزين فقط بلا ضغط"]].map(([v, l]) => `<option value="${v}" ${CR.level === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${CR.fmt === "zip" ? `<label class="field"><span>كلمة مرور (AES-256) — اختياري</span><input type="password" id="crPw" autocomplete="off" placeholder="اتركها فارغة بدون حماية"></label><label class="field"><span>تأكيد كلمة المرور</span><input type="password" id="crPw2" autocomplete="off"></label>` : '<p class="note">صيغة TAR.GZ لا تدعم كلمة المرور. اختر ZIP للحماية.</p>'}
      <div class="acts"><button class="btn" data-c="x">إغلاق</button><button class="btn primary" data-c="go" ${files.length ? "" : "disabled"}>🗜 ضغط الآن</button></div>`;
      b.querySelectorAll("input[type=text],input[type=password]").forEach(i => i.style.cssText = "border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-height:42px;background:var(--surface)");
      b.querySelector("#crName").oninput = e => CR.name = e.target.value;
      b.querySelector("#crLv").onchange = e => CR.level = +e.target.value;
      b.querySelectorAll("[data-f]").forEach(x => x.onclick = () => { CR.fmt = x.dataset.f; render(); });
      b.querySelectorAll("[data-rm]").forEach(x => x.onclick = () => { CR.items = CR.items.filter(i => i.path !== x.dataset.rm); render(); });
      b.querySelector('[data-c="files"]').onclick = async () => { const fs = await pickFiles(fileInput("crIn", true)); for (const f of fs) CR.items.push({ path: f.name, file: f, size: f.size }); render(); };
      b.querySelector('[data-c="folder"]').onclick = async () => { const r = await pickFolderFiles(); if (r) { CR.items.push(...r.items); if (!CR.name) CR.name = r.name; render(); } };
      b.querySelector('[data-c="x"]').onclick = () => close(null);
      b.querySelector('[data-c="go"]').onclick = async () => {
        const pw = b.querySelector("#crPw")?.value || "", pw2 = b.querySelector("#crPw2")?.value || "";
        if (pw !== pw2) { toast("كلمتا المرور غير متطابقتين"); return; }
        close(null);
        const name = (CR.name.trim() || "أرشيف").replace(/[\\/:*?"<>|]/g, "_") + (CR.fmt === "zip" ? ".zip" : ".tar.gz");
        busy("جاري الضغط...");
        try {
          const items = CR.items.slice();
          const out = CR.fmt === "zip" ? await zipCreate(items, { password: pw || null, level: CR.level }, m => busy("جاري الضغط\n" + m)) : await tgzCreate(items, m => busy("جاري الضغط\n" + m));
          busy();
          createResult(new File([out], name, { type: CR.fmt === "zip" ? "application/zip" : "application/gzip" }), total);
          CR.items = []; CR.name = "";
        } catch (e) { busy(); toast("تعذر الضغط: " + (e.message || e), 6000); }
      };
    };
    render();
  });
}
async function createResult(file, orig) {
  const k = await choose("✅ تم إنشاء الأرشيف", [["save", "💾 حفظ في الهاتف", "اختر مكان الحفظ"], ["share", "↗ مشاركة", "واتساب، بريد..."], ["view", "🗂 عرض في مدير الأرشيف", "تصفح المحتوى"]],
    `${file.name} — ${hs(orig)} ← ${hs(file.size)}${orig ? ` (توفير ${Math.max(0, Math.round(100 - file.size * 100 / orig))}%)` : ""}`);
  if (k === "save") saveFile(file.name, file);
  if (k === "share") shareFile(file.name, file);
  if (k === "view") { ARC.dirty = false; arcLoad(file, null); }
}
async function unzipQuick() {
  const [f] = await pickFiles(fileInput("arcIn", false)); if (!f) return;
  await arcLoad(f);
  if (ARC.A && ARC.A.file === f) arcExtractTo(null);
}

/* ═════════════════════════ الربط بالواجهة ═════════════════════════ */
const css = `
.nlov{position:fixed;inset:0;z-index:15;background:var(--bg);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
.nlov[hidden]{display:none}
.nlov>header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--surface);border-bottom:1px solid var(--line)}
.nlov .ttl{flex:1;min-width:0;font-weight:600;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nlov .ibtn,.flist .ibtn{border:0;background:none;min-width:40px;height:40px;border-radius:20px;font-size:18px;color:var(--fg)}
.nlov .ibtn:active{background:var(--sunken)}
.nlov>.bar{display:flex;gap:6px;overflow-x:auto;padding:8px 10px;background:var(--surface);border-bottom:1px solid var(--line);scrollbar-width:none}
.nlov>.bar[hidden]{display:none}
.nlov>.bar button{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:62px;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:5px 8px;font-size:11.5px;white-space:nowrap}
.nlov>.bar button b{font-size:18px;font-weight:400;line-height:1.2}
.nlov>.bar button:disabled{opacity:.38}
.nlov>.body{flex:1;overflow:auto;padding:12px 14px 96px;display:flex;flex-direction:column;gap:12px}
.nlov>.body>*{flex-shrink:0}
.nlov .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:12px;display:flex;flex-direction:column;gap:10px}
.row2{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.row2 .grow,.grow{flex:1}
.btn.sm{padding:6px 10px;font-size:13px;min-height:36px}
.big1{min-height:52px;justify-content:center;font-size:16px;font-weight:600}
.segm{display:flex;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)}
.segm button{flex:1;border:0;background:none;padding:10px 6px;font-weight:500}
.segm.sm button{padding:7px 6px;font-size:13px}
.segm button.on{background:var(--accent);color:var(--accent-fg)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chips button{border:1px solid var(--line);background:var(--bg);border-radius:18px;padding:6px 14px;font-size:14px}
.chips button.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);font-weight:600}
.ck{display:flex;gap:10px;align-items:flex-start;font-size:14px}.ck input{width:20px;height:20px;flex:0 0 auto;margin-top:2px}.ck small{color:var(--muted)}
.nlov input[type=range]{width:100%}
.flist{display:flex;flex-direction:column}
.flist .fi{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}
.flist .fi:last-child{border-bottom:0}
.fi .ic,.res .ic,.arc-row .ic{font-size:22px;width:30px;text-align:center;flex:0 0 auto}
.fi .nm,.res .nm,.arc-row .nm{flex:1;min-width:0;display:flex;flex-direction:column}
.fi .nm strong,.res .nm strong,.arc-row .nm strong{text-align:start;font-weight:500;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fi .nm small,.res .nm small,.arc-row .nm small{color:var(--muted);font-size:12px}
.res{border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:8px}
.res.err small{color:var(--danger)}
.res b.good{color:var(--accent)}.res b.warn{color:#c27c00}
.acts2{justify-content:flex-end}
.arc-info{font-size:12.5px;color:var(--muted);margin:0}
.arc-q{width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-height:42px;background:var(--surface)}
.arc-crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:13px}
.arc-crumbs button{border:0;background:var(--accent-soft);color:var(--accent);border-radius:14px;padding:3px 10px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.arc-crumbs span{color:var(--muted)}
.arc-list{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)}
.arc-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid var(--line)}
.arc-row:last-child{border-bottom:0}
.arc-row:active{background:var(--sunken)}
.arc-row input{width:22px;height:22px;flex:0 0 auto}
.arc-row .go{color:var(--muted);font-size:18px;padding:0 4px}
.arc-selbar{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));background:var(--fg);color:var(--bg);border-radius:14px;padding:8px 10px;display:flex;align-items:center;gap:8px;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.arc-selbar span{flex:1;font-weight:600}
.arc-selbar .btn{background:var(--bg);color:var(--fg);border:0}
.arc-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:30px 10px}
.big2{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}.big2 .btn{min-height:50px;padding:0 20px;font-size:15px}
.sheetdlg .flist .fi .nm strong{font-size:13px}
.muted{color:var(--muted)}
`;
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);

// بطاقات الصفحة الرئيسية
const grid = document.querySelector("#v-home .grid");
if (grid) {
  const after = grid.querySelector('[data-act="convertMenu"]') || grid.lastElementChild;
  after.insertAdjacentHTML("afterend",
    `<button class="tile" data-act="sizeTool"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg><strong>الحجم والجودة</strong><span>تصغير أي ملف حتى 1 MB أو أقل، أو تكبيره حتى 5 MB مع تحسين الوضوح</span></button>` +
    `<button class="tile" data-act="arcTool"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v2M12 7v2M12 11v2"/><rect x="10" y="13" width="4" height="5" rx="1"/></svg><strong>ZIP وفك الضغط</strong><span>إنشاء ZIP بكلمة مرور، فتح ZIP و7Z وRAR، ومدير الأرشيف</span></button>`);
}
Object.assign(ACTS, {
  sizeTool: () => sizeOpen(null),
  arcTool: async () => {
    if (ARC.A) { arcOpenUi(); return; }
    const k = await choose("ZIP وفك الضغط", [["new", "🗜 إنشاء ZIP", "ضغط ملفات أو مجلد كامل، مع كلمة مرور اختيارية"], ["unzip", "📤 فك ضغط أرشيف", "ZIP، 7Z، RAR، TAR، GZ، ISO"], ["mgr", "🗂 مدير الأرشيف", "تصفح وتعديل الملفات المضغوطة"]]);
    if (k === "new") createOpen(); if (k === "unzip") unzipQuick(); if (k === "mgr") arcOpenUi();
  },
});
// أداة في قائمة أدوات PDF
try { TOOLS.push(["sizeTool", "الحجم والجودة", "تصغير حتى 1 MB أو تكبير حتى 5 MB"]); } catch (e) {}

// فتح الأرشيفات من «فتح ملف» ومن «فتح باستخدام» في الهاتف
const _openAny = openAnyFile;
openAnyFile = async function (f) {
  const ext = extOf(f.name);
  if (arcType(f.name) && !OFFICE_ZIP.includes(ext)) return arcLoad(f);
  if (!ext || ext === "bin" || ext === "dat") { try { if (await arcSniff(f)) return arcLoad(f); } catch (e) {} }
  return _openAny(f);
};
// زر الرجوع في الهاتف يغلق النوافذ
const back = window.NL_back;
window.NL_back = () => {
  if (document.querySelector(".scrim")) return back ? back() : false;
  const ovs = [...document.querySelectorAll(".nlov")].filter(o => !o.hidden);
  if (ovs.length) { closeOverlay(ovs[ovs.length - 1]); return true; }
  return back ? back() : false;
};
// للاختبار والتكامل
window.NLFiles = { sizeProcess, imgCompress, imgEnhance, pdfCompress, pdfEnhance, officeCompress, officeEnhance, arcOpenFile, arcGet, arcExtractEach, zipCreate, tgzCreate, zipRewrite, arcTest, sizeOpen, arcLoad, createOpen, ARC, SZ, hs };
})();
