// Ground-truth probe against /server pdf-lib.
const mod = require("pdf-lib");
const PDFDocument = mod.PDFDocument;
const d = PDFDocument.create();
const proto = Object.getPrototypeOf(d);
console.log("server pdf-lib create() proto ctor:", proto && proto.constructor && proto.constructor.name);
console.log("server addPage on instance?", typeof d.addPage);
try {
  const page = d.addPage([64, 64]);
  console.log("server addPage OK -> page.drawText?", typeof page.drawText, "setRotation?", typeof page.setRotation);
} catch (e) {
  console.log("server addPage THREW:", e.message);
}
console.log("SERVER_PROBE_DONE");
