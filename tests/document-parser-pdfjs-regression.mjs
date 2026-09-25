#!/usr/bin/env node

import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const pdfJsModulePath = process.env.MEDNOTE_PDFJS_MODULE;

if (!pdfJsModulePath) {
  console.error("Set MEDNOTE_PDFJS_MODULE to the pdfjs-dist legacy build module path.");
  process.exit(1);
}

const pdfjsLib = await import(pathToFileURL(pdfJsModulePath).href);

function loadParser() {
  const source = fs.readFileSync(path.join(rootDir, "document-parser.js"), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "document-parser.js" });
  return context.window.MedNoteDocumentParser;
}

async function extractWithPdfJs(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ");
    pages.push({ pageNumber, text });
  }
  return { method: "text", pages, fullText: pages.map((page) => page.text).join("\n\n") };
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => {
    if (current == null) return undefined;
    if (key === "value" && typeof current === "object" && "value" in current) return current.value;
    return current[key];
  }, value);
}

function assertEqual(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function findInvestigation(result, query) {
  return result.investigations.find((item) => {
    if (query.type && item.type !== query.type) return false;
    if (query.name && item.name !== query.name) return false;
    return true;
  });
}

const cases = [
  {
    name: "PDF1 baseline native text",
    path: process.env.MEDNOTE_PDF1,
    fields: {
      "patient.fullName.value": "Сенатова Яна Вячеславовна",
      "patient.birthDate.value": "1993-06-13",
      "document.date.value": "2026-09-22",
      "clinical.icdCode.value": "E78.4"
    },
    investigationsCount: 7
  },
  {
    name: "PDF2 baseline synthetic native text",
    path: process.env.MEDNOTE_PDF2,
    fields: {
      "patient.fullName.value": "Иванова Мария Сергеевна",
      "patient.birthDate.value": "1988-11-07",
      "document.date.value": "2026-10-14",
      "anthropometry.heightCm.value": "168",
      "anthropometry.weightKg.value": "72",
      "clinical.icdCode.value": "E03.9"
    },
    investigations: [
      { type: "tsh", value: "6.80" },
      { type: "free_t4", value: "10.2" },
      { type: "anti_tpo", value: "186" }
    ]
  }
];

const parser = loadParser();
let failed = 0;
for (const testCase of cases) {
  const failures = [];
  if (!testCase.path) {
    console.error(`Missing path for ${testCase.name}. Set MEDNOTE_PDF1 and MEDNOTE_PDF2.`);
    process.exit(1);
  }
  const extraction = await extractWithPdfJs(testCase.path);
  const result = parser.parseMedicalDocument(extraction);
  Object.entries(testCase.fields).forEach(([fieldPath, expected]) => {
    assertEqual(getPath(result, fieldPath), expected, fieldPath, failures);
  });
  if (testCase.investigationsCount !== undefined) {
    assertEqual(result.investigations.length, testCase.investigationsCount, "investigations.length", failures);
  }
  (testCase.investigations || []).forEach((expected) => {
    const investigation = findInvestigation(result, expected);
    if (!investigation) {
      failures.push(`investigation ${expected.type || expected.name}: missing`);
      return;
    }
    Object.entries(expected).forEach(([key, value]) => {
      if (key === "type" || key === "name") return;
      assertEqual(investigation[key], value, `investigation ${expected.type || expected.name}.${key}`, failures);
    });
  });
  if (failures.length) {
    failed += 1;
    console.log(`FAIL ${testCase.name}`);
    failures.forEach((failure) => console.log(`  - ${failure}`));
  } else {
    console.log(`PASS ${testCase.name}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} PDF.js regressions passed`);
if (failed) process.exit(1);
