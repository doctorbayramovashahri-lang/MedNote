#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");
const fixtureDir = path.join(__dirname, "fixtures", "document-parser");

function loadParser() {
  const source = fs.readFileSync(path.join(rootDir, "document-parser.js"), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "document-parser.js" });
  return context.window.MedNoteDocumentParser;
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => {
    if (current == null) return undefined;
    if (key === "value" && typeof current === "object" && "value" in current) return current.value;
    return current[key];
  }, value);
}

function findInvestigation(result, query) {
  const matches = result.investigations.filter((item) => {
    if (query.type && item.type !== query.type) return false;
    if (query.name && item.name !== query.name) return false;
    return true;
  });
  return matches[query.index || 0];
}

function assertEqual(actual, expected, label, failures) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function runFixture(parser, fixturePath) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const result = parser.parseMedicalDocument(fixture.input);
  const failures = [];
  Object.entries(fixture.expected?.fields || {}).forEach(([fieldPath, expected]) => {
    assertEqual(getPath(result, fieldPath), expected, fieldPath, failures);
  });
  (fixture.expected?.investigations || []).forEach((expected) => {
    const investigation = findInvestigation(result, expected);
    if (!investigation) {
      failures.push(`investigation ${expected.type || expected.name}: missing`);
      return;
    }
    Object.entries(expected).forEach(([key, value]) => {
      if (key === "type" || key === "name" || key === "index") return;
      assertEqual(investigation[key], value, `investigation ${expected.type || expected.name}.${key}`, failures);
    });
  });
  (fixture.expected?.warningsContain || []).forEach((expected) => {
    if (!result.warnings.some((warning) => warning.includes(expected))) {
      failures.push(`warnings: expected one containing ${JSON.stringify(expected)}, got ${JSON.stringify(result.warnings)}`);
    }
  });
  (fixture.expected?.diagnostics || []).forEach((expected) => {
    const diagnostic = result.diagnostics.find((item) => {
      if (expected.field && item.field !== expected.field) return false;
      if (expected.rule && item.rule !== expected.rule) return false;
      return true;
    });
    if (!diagnostic) {
      failures.push(`diagnostic ${expected.field || expected.rule}: missing`);
      return;
    }
    Object.entries(expected).forEach(([key, value]) => {
      if (key === "field" || key === "rule") return;
      assertEqual(diagnostic[key], value, `diagnostic ${expected.field || expected.rule}.${key}`, failures);
    });
  });
  (fixture.mustNot || []).forEach((assertion) => {
    if (assertion.path) {
      const actual = getPath(result, assertion.path);
      if (actual === assertion.equal) failures.push(`mustNot ${assertion.path}: unexpectedly equals ${JSON.stringify(assertion.equal)}`);
      if (assertion.contain && String(actual || "").includes(assertion.contain)) {
        failures.push(`mustNot ${assertion.path}: unexpectedly contains ${JSON.stringify(assertion.contain)}`);
      }
    }
    if (assertion.investigation) {
      const investigation = findInvestigation(result, assertion.investigation);
      if (investigation && assertion.value !== undefined && investigation.value === assertion.value) {
        failures.push(`mustNot investigation ${assertion.investigation.type || assertion.investigation.name}: unexpected value ${assertion.value}`);
      }
    }
  });
  const comparable = (parsed) => JSON.stringify({
    patient: parsed.patient,
    document: parsed.document,
    anthropometry: parsed.anthropometry,
    clinical: parsed.clinical,
    investigations: parsed.investigations,
    warnings: parsed.warnings,
    diagnostics: parsed.diagnostics.map((item) => ({ field: item.field, rule: item.rule, confidence: item.confidence, reason: item.reason }))
  });
  const secondRun = parser.parseMedicalDocument(fixture.input);
  if (comparable(result) !== comparable(secondRun)) {
    failures.push("determinism: second parser run produced different structured output");
  }
  return { fixture, result, failures };
}

function main() {
  const parser = loadParser();
  const files = fs.readdirSync(fixtureDir).filter((file) => file.endsWith(".json")).sort();
  let failed = 0;
  files.forEach((file) => {
    const output = runFixture(parser, path.join(fixtureDir, file));
    if (output.failures.length) {
      failed += 1;
      console.log(`FAIL ${file}`);
      output.failures.forEach((failure) => console.log(`  - ${failure}`));
    } else {
      console.log(`PASS ${file}`);
    }
  });
  console.log(`\n${files.length - failed}/${files.length} fixtures passed`);
  if (failed) process.exit(1);
}

main();
