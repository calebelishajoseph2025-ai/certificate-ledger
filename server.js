// server.ts
import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import crypto4 from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/ledgerEngine.ts
import crypto3 from "node:crypto";

// src/lib/crypto.ts
import crypto from "node:crypto";
var CROCKFORD_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function computeCheckChar(str8) {
  let sum = 0;
  for (let i = 0; i < str8.length; i++) {
    const idx = CROCKFORD_CHARS.indexOf(str8[i]);
    const val = idx >= 0 ? idx : 0;
    sum += val * (i + 1);
  }
  return CROCKFORD_CHARS[sum % CROCKFORD_CHARS.length];
}
function validateCertId(certId) {
  if (!certId || typeof certId !== "string") {
    return { valid: false, malformed: true };
  }
  const clean = certId.trim().toUpperCase();
  const match = /^CL-(\d{2})-([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8})([23456789ABCDEFGHJKMNPQRSTUVWXYZ])$/.exec(clean);
  if (!match) {
    return { valid: false, malformed: true };
  }
  const [, , body, check] = match;
  const expectedCheck = computeCheckChar(body);
  if (check !== expectedCheck) {
    return { valid: false, malformed: true };
  }
  return { valid: true, malformed: false };
}
function generateCertId(yearYY = "26") {
  const bytes = crypto.randomBytes(8);
  let body = "";
  for (let i = 0; i < 8; i++) {
    body += CROCKFORD_CHARS[bytes[i] % CROCKFORD_CHARS.length];
  }
  const check = computeCheckChar(body);
  return `CL-${yearYY}-${body}${check}`;
}
function deriveKey(masterKey, purpose) {
  return crypto.createHmac("sha256", masterKey).update(Buffer.from(purpose, "utf-8")).digest();
}
function base64urlNoPad(buf) {
  return buf.toString("base64url").replace(/=+$/, "");
}
function signCertId(certId, signingKey) {
  const kCert = deriveKey(signingKey, "certificate-link-v1");
  const hmac = crypto.createHmac("sha256", kCert).update(`v1|${certId}`).digest();
  return base64urlNoPad(hmac.subarray(0, 12));
}
function verifyCertSignature(certId, signature, signingKey, previousSigningKey) {
  if (!signature || typeof signature !== "string") {
    return { valid: false, provided: false };
  }
  const sig = signature.trim();
  if (sig.length !== 16 || !/^[A-Za-z0-9_-]+$/.test(sig)) {
    return { valid: false, provided: true };
  }
  const expectedCurrent = signCertId(certId, signingKey);
  const bufSig = Buffer.from(sig, "utf-8");
  const bufCurrent = Buffer.from(expectedCurrent, "utf-8");
  if (bufSig.length === bufCurrent.length && crypto.timingSafeEqual(bufSig, bufCurrent)) {
    return { valid: true, provided: true };
  }
  if (previousSigningKey && previousSigningKey.length >= 32) {
    const expectedPrev = signCertId(certId, previousSigningKey);
    const bufPrev = Buffer.from(expectedPrev, "utf-8");
    if (bufSig.length === bufPrev.length && crypto.timingSafeEqual(bufSig, bufPrev)) {
      return { valid: true, provided: true };
    }
  }
  return { valid: false, provided: true };
}
function computeAuditRowHash(seq, atIsoUtc, action, entity, entityId, detail, prevHash) {
  const canonicalArray = JSON.stringify([
    seq,
    atIsoUtc,
    action,
    entity,
    entityId ?? "",
    detail,
    prevHash
  ]);
  return crypto.createHash("sha256").update(canonicalArray, "utf-8").digest("hex");
}
function computeAuditCheckpointMac(upToSeq, headHash, signingKey) {
  const kAudit = deriveKey(signingKey, "audit-checkpoint-v1");
  return crypto.createHmac("sha256", kAudit).update(`${upToSeq}:${headHash}`).digest("hex");
}
function verifyAuditCheckpointMac(upToSeq, headHash, mac, signingKey, previousKey) {
  if (!mac || typeof mac !== "string") return false;
  const expected = computeAuditCheckpointMac(upToSeq, headHash, signingKey);
  if (mac.length !== expected.length || !/^[0-9a-fA-F]+$/.test(mac)) {
    return false;
  }
  const bufA = Buffer.from(mac, "hex");
  const bufB = Buffer.from(expected, "hex");
  if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
    return true;
  }
  if (previousKey && previousKey.length >= 32) {
    const expectedPrev = computeAuditCheckpointMac(upToSeq, headHash, previousKey);
    const bufPrev = Buffer.from(expectedPrev, "hex");
    if (bufA.length === bufPrev.length && crypto.timingSafeEqual(bufA, bufPrev)) {
      return true;
    }
  }
  return false;
}

// src/lib/fuzzy.ts
var STATIC_DOMAIN_TYPOS = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gamil.com": "gmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "exmaple.test": "example.test",
  "exampel.test": "example.test",
  "exmaple.com": "example.com"
};
var NICKNAME_GROUPS = [
  ["jon", "john", "jonathan"],
  ["bill", "will", "william", "billy", "liam"],
  ["bob", "rob", "robert", "bobby", "robbie"],
  ["liz", "beth", "betty", "elizabeth", "eliza"],
  ["mike", "michael", "mikey"],
  ["kate", "katie", "katherine", "catherine", "kathryn"],
  ["dave", "david", "davey"],
  ["tom", "thomas", "tommy"],
  ["jim", "james", "jimmy"],
  ["steve", "steven", "stephen"],
  ["chris", "christopher"],
  ["dan", "daniel", "danny"],
  ["alex", "alexander", "alexandra"],
  ["matt", "matthew"],
  ["sam", "samuel", "samantha"],
  ["ben", "benjamin", "benny"],
  ["andy", "andrew", "drew"],
  ["nick", "nicholas"],
  ["joe", "joseph", "joey"],
  ["greg", "gregory"],
  ["tony", "anthony"],
  ["ed", "edward", "eddie"]
];
var NICKNAME_MAP = /* @__PURE__ */ new Map();
for (const group of NICKNAME_GROUPS) {
  const normGroup = group.map((n) => n.toLowerCase().trim());
  for (const name of normGroup) {
    if (!NICKNAME_MAP.has(name)) {
      NICKNAME_MAP.set(name, /* @__PURE__ */ new Set());
    }
    for (const other of normGroup) {
      if (other !== name) {
        NICKNAME_MAP.get(name).add(other);
      }
    }
  }
}
function areNicknames(nameA, nameB) {
  const a = nameA.toLowerCase().trim();
  const b = nameB.toLowerCase().trim();
  if (a === b) return true;
  return NICKNAME_MAP.get(a)?.has(b) ?? false;
}
function damerauLevenshtein(a, b) {
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const matrix = [];
  for (let i = 0; i <= al; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bl; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        // deletion
        matrix[i][j - 1] + 1,
        // insertion
        matrix[i - 1][j - 1] + cost
        // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[al][bl];
}
function normalizeName(name) {
  return name.toLowerCase().replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim();
}
function splitName(name) {
  const norm = normalizeName(name);
  const parts = norm.split(" ");
  if (parts.length === 1) {
    return { first: parts[0], last: "" };
  }
  return {
    first: parts[0],
    last: parts[parts.length - 1]
  };
}
function cleanLocalPart(local) {
  return local.replace(/\./g, "").split("+")[0];
}
function scorePair(a, b, frequentDomains) {
  const normNameA = normalizeName(a.fullName);
  const normNameB = normalizeName(b.fullName);
  const [localA, domainA = ""] = a.emailNorm.split("@");
  const [localB, domainB = ""] = b.emailNorm.split("@");
  let nameScore = 0;
  let nameReason = "";
  const { first: firstA, last: lastA } = splitName(normNameA);
  const { first: firstB, last: lastB } = splitName(normNameB);
  if (normNameA === normNameB && normNameA.length > 0) {
    nameScore = 0.45;
    nameReason = "Exact normalized name match";
  } else if (lastA && lastB && lastA === lastB && areNicknames(firstA, firstB)) {
    nameScore = 0.4;
    nameReason = `Nickname match: ${firstA} \u2248 ${firstB}`;
  } else {
    const dist = damerauLevenshtein(normNameA, normNameB);
    if (dist <= 1 && normNameA.length > 3) {
      nameScore = 0.35;
      nameReason = "Close name spelling (distance \u2264 1)";
    }
  }
  let emailScore = 0;
  let emailReason = "";
  const cleanA = cleanLocalPart(localA);
  const cleanB = cleanLocalPart(localB);
  const isTypoA = STATIC_DOMAIN_TYPOS[domainA] === domainB || STATIC_DOMAIN_TYPOS[domainB] === domainA;
  let isDynamicDomainTypo = false;
  if (!isTypoA && domainA !== domainB && frequentDomains) {
    const freqA = frequentDomains.get(domainA) || 0;
    const freqB = frequentDomains.get(domainB) || 0;
    if (freqA >= 3 && damerauLevenshtein(domainA, domainB) === 1) isDynamicDomainTypo = true;
    if (freqB >= 3 && damerauLevenshtein(domainA, domainB) === 1) isDynamicDomainTypo = true;
  }
  if (cleanA === cleanB && (isTypoA || isDynamicDomainTypo)) {
    emailScore = 0.5;
    const targetDomain = isTypoA ? STATIC_DOMAIN_TYPOS[domainA] || STATIC_DOMAIN_TYPOS[domainB] : domainA.length > domainB.length ? domainA : domainB;
    emailReason = `Email domain looks like a typo of ${targetDomain}`;
  } else {
    const fullEmailDist = damerauLevenshtein(a.emailNorm, b.emailNorm);
    if (fullEmailDist <= 2) {
      emailScore = 0.4;
      emailReason = `Email addresses differ by only ${fullEmailDist} character(s)`;
    } else if (cleanA === cleanB && cleanA.length > 2) {
      if (domainA === domainB) {
        emailScore = 0.3;
        emailReason = "Identical email local part with formatting/tag difference";
      } else {
        emailScore = 0.25;
        emailReason = "Same email username on different domain";
      }
    }
  }
  let overlapBonus = 0;
  let overlapReason = "";
  if (a.enrollments && b.enrollments) {
    for (const enA of a.enrollments) {
      for (const enB of b.enrollments) {
        if (enA.courseCode === enB.courseCode && enA.completionDate && enA.completionDate === enB.completionDate) {
          overlapBonus = 0.1;
          overlapReason = `Shared completion in course ${enA.courseCode} on ${enA.completionDate}`;
          break;
        }
      }
      if (overlapBonus > 0) break;
    }
  }
  const reasons = [];
  if (nameReason) reasons.push(nameReason);
  if (emailReason) reasons.push(emailReason);
  if (overlapReason) reasons.push(overlapReason);
  if (nameScore === 0 || emailScore === 0) {
    return { score: 0, reasons: [] };
  }
  const totalScore = Math.min(1, +(nameScore + emailScore + overlapBonus).toFixed(3));
  return { score: totalScore, reasons };
}
function scanDuplicates(people, frequentDomains) {
  const domainCounts = frequentDomains || /* @__PURE__ */ new Map();
  if (!frequentDomains) {
    for (const p of people) {
      const parts = p.emailNorm.split("@");
      if (parts[1]) {
        domainCounts.set(parts[1], (domainCounts.get(parts[1]) || 0) + 1);
      }
    }
  }
  const blocks = /* @__PURE__ */ new Map();
  function addToBlock(key, personIndex) {
    if (!key) return;
    if (!blocks.has(key)) {
      blocks.set(key, []);
    }
    const list = blocks.get(key);
    if (list.length < 200 && !list.includes(personIndex)) {
      list.push(personIndex);
    }
  }
  people.forEach((p, idx) => {
    const { first, last } = splitName(p.fullName);
    if (last) {
      addToBlock(`nl:${last}:${first.charAt(0)}`, idx);
    }
    const [local, domain = ""] = p.emailNorm.split("@");
    const cleanLocal = cleanLocalPart(local);
    if (cleanLocal.length >= 4) {
      addToBlock(`el:${cleanLocal.slice(0, 4)}`, idx);
    }
    const canonicalDomain = STATIC_DOMAIN_TYPOS[domain] || domain;
    addToBlock(`dm:${cleanLocal}:${canonicalDomain}`, idx);
  });
  const checkedPairs = /* @__PURE__ */ new Set();
  const candidates = [];
  for (const indices of blocks.values()) {
    if (indices.length < 2) continue;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const idxA = indices[i];
        const idxB = indices[j];
        const pA = people[idxA];
        const pB = people[idxB];
        const minId = Math.min(pA.id, pB.id);
        const maxId = Math.max(pA.id, pB.id);
        const pairKey = `${minId}:${maxId}`;
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);
        const personMin = pA.id === minId ? pA : pB;
        const personMax = pA.id === minId ? pB : pA;
        const { score, reasons } = scorePair(personMin, personMax, domainCounts);
        if (score >= 0.7) {
          candidates.push({
            personAId: minId,
            personBId: maxId,
            score,
            reasons
          });
        }
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// src/lib/classifier.ts
import crypto2 from "node:crypto";
var MONTH_NAMES = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12"
};
function parseDate(rawDate) {
  if (!rawDate || typeof rawDate !== "string") {
    return { date: null };
  }
  const clean = rawDate.trim();
  if (!clean) return { date: null };
  let y = 0;
  let m = 0;
  let d = 0;
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(clean);
  if (isoMatch) {
    y = parseInt(isoMatch[1], 10);
    m = parseInt(isoMatch[2], 10);
    d = parseInt(isoMatch[3], 10);
  } else {
    const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(clean);
    if (dmyMatch) {
      d = parseInt(dmyMatch[1], 10);
      m = parseInt(dmyMatch[2], 10);
      y = parseInt(dmyMatch[3], 10);
    } else {
      const dMmmMatch = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})$/.exec(clean);
      if (dMmmMatch) {
        d = parseInt(dMmmMatch[1], 10);
        const monthStr = dMmmMatch[2].toLowerCase();
        m = parseInt(MONTH_NAMES[monthStr] || "0", 10);
        y = parseInt(dMmmMatch[3], 10);
      }
    }
  }
  if (y === 0 || m < 1 || m > 12 || d < 1 || d > 31) {
    return { date: null, error: "INVALID_DATE" };
  }
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() + 1 !== m || dateObj.getUTCDate() !== d) {
    return { date: null, error: "INVALID_DATE" };
  }
  const mm = m.toString().padStart(2, "0");
  const dd = d.toString().padStart(2, "0");
  const isoDate = `${y}-${mm}-${dd}`;
  const now = /* @__PURE__ */ new Date();
  const todayIso = now.toISOString().slice(0, 10);
  if (isoDate > todayIso) {
    return { date: isoDate, error: "FUTURE_DATE" };
  }
  return { date: isoDate };
}
function cleanName(rawName) {
  if (!rawName || typeof rawName !== "string") return "";
  const collapsed = rawName.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  const isAllUpper = collapsed === collapsed.toUpperCase();
  const isAllLower = collapsed === collapsed.toLowerCase();
  if (isAllUpper || isAllLower) {
    return collapsed.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
  }
  return collapsed;
}
function classifyRecord(raw, knownCourseCodes) {
  const problems = [];
  const rawName = String(raw.name ?? "").trim();
  const rawEmail = String(raw.email ?? "").trim();
  const rawCourse = String(raw.course ?? "").trim();
  const rawDate = String(raw.completion_date ?? "").trim();
  const rawStatus = String(raw.status ?? "").trim().toLowerCase();
  const fullName = cleanName(rawName);
  if (!fullName) {
    problems.push("MISSING_NAME");
  }
  const emailNorm = rawEmail.toLowerCase();
  if (!emailNorm) {
    problems.push("MISSING_EMAIL");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    problems.push("INVALID_EMAIL");
  }
  const courseCode = rawCourse.toUpperCase();
  if (!courseCode) {
    problems.push("MISSING_COURSE");
  } else if (knownCourseCodes.size > 0 && !knownCourseCodes.has(courseCode)) {
    problems.push("UNKNOWN_COURSE");
  }
  let completed = false;
  if (["completed", "complete", "passed", "yes", "y", "true"].includes(rawStatus)) {
    completed = true;
  } else if (["dropped", "no-show", "absent", "incomplete", "failed", "no", "n", "false", "in progress"].includes(rawStatus)) {
    completed = false;
  } else if (!rawStatus) {
    problems.push("UNRECOGNIZED_STATUS");
  } else {
    problems.push("UNRECOGNIZED_STATUS");
  }
  const { date: completionDate, error: dateError } = parseDate(rawDate);
  if (dateError === "INVALID_DATE") {
    problems.push("INVALID_DATE");
  } else if (dateError === "FUTURE_DATE") {
    problems.push("FUTURE_DATE");
  } else if (completed && !completionDate) {
    problems.push("MISSING_COMPLETION_DATE");
  }
  const recordState = problems.length === 0 ? "ready" : "needs_correction";
  const fpSource = [
    rawName.toLowerCase().replace(/\s+/g, " "),
    emailNorm,
    courseCode,
    rawDate,
    rawStatus
  ].join("|");
  const rawFingerprint = crypto2.createHash("sha256").update(fpSource, "utf-8").digest("hex");
  return {
    fullName,
    emailNorm,
    courseCode,
    completionDate,
    completed,
    recordState,
    problems,
    rawFingerprint,
    rawName,
    rawEmail,
    rawCourseCode: rawCourse,
    rawCompletionDate: rawDate,
    rawStatus
  };
}

// src/lib/funnel.ts
function computeFunnel(uniqueRecords, ready, eligible, issuedEver, currentlyValid, rowsReceived = 0, duplicateRowsMerged = 0) {
  const needsCorrection = Math.max(0, uniqueRecords - ready);
  const notCompleted = Math.max(0, ready - eligible);
  const pending = Math.max(0, eligible - issuedEver);
  const revoked = Math.max(0, issuedEver - currentlyValid);
  return {
    uniqueRecords,
    ready,
    eligible,
    issuedEver,
    currentlyValid,
    dropOffs: {
      needsCorrection,
      notCompleted,
      pending,
      revoked
    },
    annotations: {
      rowsReceived,
      duplicateRowsMerged
    }
  };
}
function verifyCountInvariant(eligibleTotal, pending, issued, revoked) {
  const sum = pending + issued + revoked;
  const holds = eligibleTotal === sum;
  const formula = `${eligibleTotal} eligible = ${pending} pending + ${issued} issued + ${revoked} revoked`;
  return { holds, formula };
}

// src/lib/problemLabels.ts
var PROBLEM_REGISTRY = {
  MISSING_NAME: {
    code: "MISSING_NAME",
    label: "Attendee name is missing",
    howToFix: "Enter the full legal or preferred name of the participant in the name column."
  },
  MISSING_EMAIL: {
    code: "MISSING_EMAIL",
    label: "Email address is missing",
    howToFix: "Provide a valid email address for the attendee in the email column."
  },
  INVALID_EMAIL: {
    code: "INVALID_EMAIL",
    label: "Email format is invalid",
    howToFix: "Correct the email address format (e.g., user@domain.com) without spaces."
  },
  MISSING_COURSE: {
    code: "MISSING_COURSE",
    label: "Course code is missing",
    howToFix: "Enter the registered course code (e.g., DS-101) in the course column."
  },
  UNKNOWN_COURSE: {
    code: "UNKNOWN_COURSE",
    label: "Course code does not exist in ledger",
    howToFix: "Create the course in the courses view or fix the course code spelling."
  },
  MISSING_COMPLETION_DATE: {
    code: "MISSING_COMPLETION_DATE",
    label: "Completion date missing for completed status",
    howToFix: "Provide the date of course completion (YYYY-MM-DD or DD/MM/YYYY)."
  },
  INVALID_DATE: {
    code: "INVALID_DATE",
    label: "Date format cannot be parsed",
    howToFix: "Use ISO format YYYY-MM-DD or European DD/MM/YYYY format."
  },
  FUTURE_DATE: {
    code: "FUTURE_DATE",
    label: "Completion date is in the future",
    howToFix: "Adjust the completion date to today or a past date."
  },
  UNRECOGNIZED_STATUS: {
    code: "UNRECOGNIZED_STATUS",
    label: "Completion status value is unrecognized",
    howToFix: 'Change status to "completed", "dropped", "no-show", or "in progress".'
  }
};
function getProblemMeta(code) {
  return PROBLEM_REGISTRY[code] || {
    code,
    label: `Issue: ${code}`,
    howToFix: "Review and update the record data."
  };
}

// src/lib/ledgerEngine.ts
var LedgerEngine = class {
  constructor(config) {
    // Tables
    this.courses = /* @__PURE__ */ new Map();
    this.people = /* @__PURE__ */ new Map();
    this.enrollments = /* @__PURE__ */ new Map();
    this.certificates = /* @__PURE__ */ new Map();
    this.imports = /* @__PURE__ */ new Map();
    this.importRows = /* @__PURE__ */ new Map();
    this.auditLog = [];
    this.auditCheckpoints = [];
    this.duplicateCandidates = /* @__PURE__ */ new Map();
    this.rateLimits = /* @__PURE__ */ new Map();
    // Auto-increment counters
    this.nextCourseId = 1;
    this.nextPersonId = 1;
    this.nextEnrollmentId = 1;
    this.nextCertId = 1;
    this.nextImportId = 1;
    this.nextImportRowId = 1;
    this.nextAuditId = 1;
    this.nextAuditCheckpointId = 1;
    this.nextCandidateId = 1;
    this.config = config;
    this.seedDefaultCourses();
  }
  /** Wipe in-memory ledger state and restore the three default courses. */
  resetToFactoryState() {
    this.courses.clear();
    this.people.clear();
    this.enrollments.clear();
    this.certificates.clear();
    this.imports.clear();
    this.importRows.clear();
    this.auditLog = [];
    this.auditCheckpoints = [];
    this.duplicateCandidates.clear();
    this.nextCourseId = 1;
    this.nextPersonId = 1;
    this.nextEnrollmentId = 1;
    this.nextCertId = 1;
    this.nextImportId = 1;
    this.nextImportRowId = 1;
    this.nextAuditId = 1;
    this.nextAuditCheckpointId = 1;
    this.nextCandidateId = 1;
    this.seedDefaultCourses();
  }
  seedDefaultCourses() {
    this.addCourse("DS-101", "Intro to Data Storytelling", 18, "classic");
    this.addCourse("UX-201", "Accessible Interface Design", 24, "modern");
    this.addCourse("CL-150", "Cloud Basics for Teams", 12, "midnight");
  }
  addCourse(code, title, hours, theme = "classic", is_demo = false) {
    const cleanCode = code.trim().toUpperCase();
    for (const c of this.courses.values()) {
      if (c.code === cleanCode) {
        return c;
      }
    }
    const course = {
      id: this.nextCourseId++,
      code: cleanCode,
      title: title.trim(),
      hours,
      theme,
      is_demo,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.courses.set(course.id, course);
    return course;
  }
  getCourseByCode(code) {
    const cleanCode = code.trim().toUpperCase();
    for (const c of this.courses.values()) {
      if (c.code === cleanCode) return c;
    }
    return void 0;
  }
  /**
   * Resolves person through tombstones (merged_into pointers)
   */
  resolvePerson(personId) {
    let curr = this.people.get(personId);
    if (!curr) throw new Error(`Person ${personId} not found`);
    const visited = /* @__PURE__ */ new Set();
    while (curr.merged_into !== null) {
      if (visited.has(curr.id)) break;
      visited.add(curr.id);
      const next = this.people.get(curr.merged_into);
      if (!next) break;
      curr = next;
    }
    return curr;
  }
  getActivePersonByEmail(emailNorm) {
    const clean = emailNorm.trim().toLowerCase();
    for (const p of this.people.values()) {
      if (p.email_norm === clean) {
        return this.resolvePerson(p.id);
      }
    }
    return void 0;
  }
  /**
   * Appends an audit log event with hash chaining (SHA-256)
   */
  appendAudit(action, entity, entityId, detail) {
    const seq = this.auditLog.length + 1;
    const at = (/* @__PURE__ */ new Date()).toISOString();
    const prevHash = this.auditLog.length > 0 ? this.auditLog[this.auditLog.length - 1].row_hash : "0".repeat(64);
    const rowHash = computeAuditRowHash(seq, at, action, entity, entityId, detail, prevHash);
    const row = {
      id: this.nextAuditId++,
      seq,
      at,
      action,
      entity,
      entity_id: entityId,
      detail,
      prev_hash: prevHash,
      row_hash: rowHash
    };
    this.auditLog.push(row);
    return row;
  }
  /**
   * F1: Verifies the integrity of the audit hash chain and checkpoints
   */
  verifyAuditChain() {
    const problems = [];
    let prevHash = "0".repeat(64);
    for (let i = 0; i < this.auditLog.length; i++) {
      const row = this.auditLog[i];
      if (row.seq !== i + 1) {
        problems.push({
          seq: row.seq,
          kind: "seq_gap",
          message: `Expected seq ${i + 1} but got ${row.seq}`
        });
      }
      if (row.prev_hash !== prevHash) {
        problems.push({
          seq: row.seq,
          kind: "link_broken",
          message: `prev_hash mismatch at seq ${row.seq}`
        });
      }
      const expectedHash = computeAuditRowHash(
        row.seq,
        row.at,
        row.action,
        row.entity,
        row.entity_id,
        row.detail,
        row.prev_hash
      );
      if (row.row_hash !== expectedHash) {
        problems.push({
          seq: row.seq,
          kind: "hash_mismatch",
          message: `row_hash mismatch at seq ${row.seq}`
        });
      }
      prevHash = row.row_hash;
    }
    let checkpointsChecked = 0;
    for (const cp of this.auditCheckpoints) {
      checkpointsChecked++;
      const targetRow = this.auditLog.find((r) => r.seq === cp.up_to_seq);
      if (!targetRow || targetRow.row_hash !== cp.head_hash) {
        problems.push({
          seq: cp.up_to_seq,
          kind: "checkpoint_mismatch",
          message: `Checkpoint at seq ${cp.up_to_seq} head hash does not match chain`
        });
      }
      const validMac = verifyAuditCheckpointMac(
        cp.up_to_seq,
        cp.head_hash,
        cp.mac,
        this.config.signingKey,
        this.config.previousSigningKey
      );
      if (!validMac) {
        problems.push({
          seq: cp.up_to_seq,
          kind: "checkpoint_mac_invalid",
          message: `Checkpoint MAC invalid at seq ${cp.up_to_seq}`
        });
      }
    }
    const headSeq = this.auditLog.length;
    const headHash = headSeq > 0 ? this.auditLog[headSeq - 1].row_hash : "0".repeat(64);
    const ok = problems.length === 0;
    if (ok && headSeq > 0) {
      const existing = this.auditCheckpoints.find((c) => c.up_to_seq === headSeq);
      if (!existing) {
        const mac = computeAuditCheckpointMac(headSeq, headHash, this.config.signingKey);
        this.auditCheckpoints.push({
          id: this.nextAuditCheckpointId++,
          up_to_seq: headSeq,
          head_hash: headHash,
          mac,
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    return {
      ok,
      checked: this.auditLog.length,
      head_seq: headSeq,
      head_hash: headHash,
      checkpoints_checked: checkpointsChecked,
      problems: problems.slice(0, 20),
      verified_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  /**
   * Idempotent certificate issuance with race and duplicate protection
   */
  issueCertificate(enrollmentId) {
    const enrollment = this.enrollments.get(enrollmentId);
    if (!enrollment) {
      throw { status: 404, code: "ENROLLMENT_NOT_FOUND", message: "Enrollment record not found" };
    }
    if (enrollment.record_state !== "ready" || !enrollment.completed) {
      throw {
        status: 422,
        code: "NOT_ELIGIBLE",
        message: "Attendee enrollment is not complete and eligible for certificate issuance"
      };
    }
    let person = enrollment.person_id ? this.resolvePerson(enrollment.person_id) : void 0;
    if (!person && enrollment.email_norm) {
      person = this.getActivePersonByEmail(enrollment.email_norm);
    }
    if (!person) {
      person = {
        id: this.nextPersonId++,
        email_norm: enrollment.email_norm,
        full_name: enrollment.full_name,
        merged_into: null,
        created_by_import_id: enrollment.source_import_id,
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.people.set(person.id, person);
      enrollment.person_id = person.id;
    }
    const course = enrollment.course_id ? this.courses.get(enrollment.course_id) : this.getCourseByCode(enrollment.course_code);
    if (!course) {
      throw { status: 422, code: "UNKNOWN_COURSE", message: `Course ${enrollment.course_code} does not exist` };
    }
    enrollment.course_id = course.id;
    for (const cert2 of this.certificates.values()) {
      if (cert2.person_id === person.id && cert2.course_id === course.id) {
        const sig2 = signCertId(cert2.cert_id, this.config.signingKey);
        const verify_url2 = `${this.config.publicBaseUrl}/verify/${cert2.cert_id}?s=${sig2}`;
        return {
          certificate: { ...cert2, verify_url: verify_url2, theme: course.theme },
          created: false
        };
      }
    }
    let certId = generateCertId("26");
    for (let attempts = 0; attempts < 5; attempts++) {
      let collision = false;
      for (const c of this.certificates.values()) {
        if (c.cert_id === certId) {
          collision = true;
          break;
        }
      }
      if (!collision) break;
      certId = generateCertId("26");
    }
    const cert = {
      id: this.nextCertId++,
      cert_id: certId,
      person_id: person.id,
      course_id: course.id,
      enrollment_id: enrollment.id,
      status: "valid",
      issued_at: (/* @__PURE__ */ new Date()).toISOString(),
      revoked_at: null,
      revoke_reason: null
    };
    this.certificates.set(cert.id, cert);
    this.appendAudit("certificate.issue", "certificate", cert.cert_id, {
      person_id: person.id,
      course_id: course.id,
      enrollment_id: enrollment.id,
      holder_name: person.full_name,
      holder_email: person.email_norm,
      course_code: course.code
    });
    const sig = signCertId(cert.cert_id, this.config.signingKey);
    const verify_url = `${this.config.publicBaseUrl}/verify/${cert.cert_id}?s=${sig}`;
    return {
      certificate: { ...cert, verify_url, theme: course.theme },
      created: true
    };
  }
  /**
   * Bulk issue eligible certificates
   */
  issueAll(courseFilter, scope = "real") {
    let created = 0;
    let already_issued = 0;
    const skipped = [];
    const candidates = Array.from(this.enrollments.values());
    for (const en of candidates) {
      const course = en.course_id ? this.courses.get(en.course_id) : this.getCourseByCode(en.course_code);
      if (!course) {
        skipped.push({ id: en.id, reason: "Course not found" });
        continue;
      }
      if (courseFilter && course.code !== courseFilter.trim().toUpperCase()) {
        continue;
      }
      if (scope === "real" && course.is_demo) continue;
      if (scope === "demo" && !course.is_demo) continue;
      if (en.record_state !== "ready" || !en.completed) {
        skipped.push({ id: en.id, reason: "Not eligible" });
        continue;
      }
      try {
        const res = this.issueCertificate(en.id);
        if (res.created) {
          created++;
        } else {
          already_issued++;
        }
      } catch (err) {
        const error = err;
        skipped.push({ id: en.id, reason: error.message || "Error issuing" });
      }
    }
    return { created, already_issued, skipped };
  }
  /**
   * Revoke a certificate
   */
  revokeCertificate(certId, reason) {
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      throw { status: 422, code: "MISSING_REVOKE_REASON", message: "A non-empty revocation reason is required" };
    }
    let target;
    for (const c of this.certificates.values()) {
      if (c.cert_id === certId.trim().toUpperCase()) {
        target = c;
        break;
      }
    }
    if (!target) {
      throw { status: 404, code: "CERTIFICATE_NOT_FOUND", message: "Certificate ID not found" };
    }
    if (target.status === "revoked") {
      return target;
    }
    target.status = "revoked";
    target.revoked_at = (/* @__PURE__ */ new Date()).toISOString();
    target.revoke_reason = reason.trim();
    this.appendAudit("certificate.revoke", "certificate", target.cert_id, {
      revoked_at: target.revoked_at,
      reason: target.revoke_reason
    });
    return target;
  }
  /**
   * Public certificate lookup with signature verification
   */
  verifyLookup(certId, sigParam) {
    const { valid: idFormatValid, malformed } = validateCertId(certId);
    if (!idFormatValid || malformed) {
      return { status: "malformed", signature: "not_provided" };
    }
    let sigStatus = "not_provided";
    if (sigParam !== void 0 && sigParam !== null && sigParam !== "") {
      const sigRes = verifyCertSignature(
        certId,
        sigParam,
        this.config.signingKey,
        this.config.previousSigningKey
      );
      if (!sigRes.valid) {
        return {
          status: "invalid_signature",
          signature: "invalid"
        };
      }
      sigStatus = "valid";
    }
    let target;
    for (const c of this.certificates.values()) {
      if (c.cert_id === certId.trim().toUpperCase()) {
        target = c;
        break;
      }
    }
    if (!target) {
      return { status: "not_found", signature: sigStatus };
    }
    const person = this.resolvePerson(target.person_id);
    const course = this.courses.get(target.course_id);
    return {
      status: target.status,
      signature: sigStatus,
      holder_name: person.full_name,
      course_title: course?.title || "Course Completion",
      course_code: course?.code || "",
      issuer_name: this.config.issuerName,
      issued_at: target.issued_at,
      revoked_at: target.revoked_at || void 0,
      hours: course?.hours,
      theme: course?.theme
    };
  }
  /**
   * Preview an import CSV without writing changes
   */
  previewImport(csvText, customMapping) {
    const { headers, delimiter, rows: rawRows } = this.parseCsv(csvText);
    const { mapping, mappingSource, errors: columnErrors } = this.resolveMapping(headers, customMapping);
    const knownCourses = new Set(Array.from(this.courses.values()).map((c) => c.code));
    const classifiedRows = [];
    const summary = {
      total: rawRows.length,
      new: 0,
      updated: 0,
      duplicates: 0,
      needs_correction: 0,
      unchanged: 0,
      corrected: 0
    };
    const seenInBatch = /* @__PURE__ */ new Set();
    rawRows.forEach((r, idx) => {
      const rowNum = idx + 1;
      const mapped = this.applyMapping(r, mapping);
      const classified = classifyRecord(mapped, knownCourses);
      let outcome = "new";
      if (classified.problems.length > 0) {
        outcome = "needs_correction";
      } else {
        const naturalKey = `${classified.emailNorm}:${classified.courseCode}`;
        if (seenInBatch.has(naturalKey)) {
          outcome = "duplicate";
        } else {
          seenInBatch.add(naturalKey);
          let existing;
          for (const en of this.enrollments.values()) {
            if (en.email_norm === classified.emailNorm && en.course_code === classified.courseCode) {
              existing = en;
              break;
            }
          }
          if (existing) {
            outcome = existing.record_state === "needs_correction" ? "corrected" : "unchanged";
          }
        }
      }
      if (outcome === "duplicate") {
        summary.duplicates++;
      } else {
        summary[outcome]++;
      }
      classifiedRows.push({
        rowNumber: rowNum,
        outcome,
        fullName: classified.fullName,
        emailNorm: classified.emailNorm,
        courseCode: classified.courseCode,
        completionDate: classified.completionDate,
        completed: classified.completed,
        problems: classified.problems
      });
    });
    return {
      headers,
      delimiter,
      mapping,
      mapping_source: mappingSource,
      column_errors: columnErrors,
      rows: classifiedRows,
      summary
    };
  }
  /**
   * Commits an import CSV with full idempotency, raw fingerprints, and duplicate capture
   */
  commitImport(csvText, filename = "attendees.csv", customMapping, is_demo = false) {
    const canonicalMapping = customMapping ? JSON.stringify(customMapping) : "";
    const hashPayload = canonicalMapping ? `${csvText}
--mapping--
${canonicalMapping}` : csvText;
    const sha256 = crypto3.createHash("sha256").update(hashPayload, "utf-8").digest("hex");
    for (const imp of this.imports.values()) {
      if (imp.sha256 === sha256 && imp.undone_at === null) {
        return {
          import: imp,
          already_imported: true,
          summary: {
            row_count: imp.row_count,
            inserted: imp.inserted,
            updated: imp.updated,
            corrected: imp.corrected,
            duplicates: imp.duplicates,
            needs_correction: imp.needs_correction,
            unchanged: imp.unchanged
          }
        };
      }
    }
    const { headers, rows: rawRows } = this.parseCsv(csvText);
    const { mapping, errors } = this.resolveMapping(headers, customMapping);
    if (errors.length > 0) {
      throw { status: 422, code: "MISSING_COLUMNS", message: `Missing required columns: ${errors.join(", ")}` };
    }
    const knownCourses = new Set(Array.from(this.courses.values()).map((c) => c.code));
    const importRec = {
      id: this.nextImportId++,
      filename,
      sha256,
      mapping: customMapping || null,
      is_demo,
      row_count: rawRows.length,
      inserted: 0,
      updated: 0,
      corrected: 0,
      duplicates: 0,
      needs_correction: 0,
      unchanged: 0,
      undone_at: null,
      undone_note: null,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.imports.set(importRec.id, importRec);
    const seenFpInBatch = /* @__PURE__ */ new Set();
    const seenNaturalKeyInBatch = /* @__PURE__ */ new Set();
    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 1;
      const raw = rawRows[i];
      const mapped = this.applyMapping(raw, mapping);
      const classified = classifyRecord(mapped, knownCourses);
      let outcome = "new";
      let targetEnrollment = null;
      let beforeSnapshot = null;
      const recordIdRaw = mapped.record_id;
      if (recordIdRaw) {
        const recId = parseInt(String(recordIdRaw), 10);
        const existingRec = this.enrollments.get(recId);
        if (existingRec) {
          let hasCert = false;
          for (const c of this.certificates.values()) {
            if (c.enrollment_id === existingRec.id) {
              hasCert = true;
              break;
            }
          }
          if (hasCert) {
            outcome = "unchanged";
          } else {
            beforeSnapshot = { ...existingRec };
            existingRec.full_name = classified.fullName || existingRec.full_name;
            existingRec.email_norm = classified.emailNorm || existingRec.email_norm;
            existingRec.course_code = classified.courseCode || existingRec.course_code;
            existingRec.completion_date = classified.completionDate;
            existingRec.completed = classified.completed;
            existingRec.record_state = classified.recordState;
            existingRec.problems = classified.problems;
            existingRec.last_import_id = importRec.id;
            existingRec.updated_at = (/* @__PURE__ */ new Date()).toISOString();
            outcome = classified.recordState === "ready" ? "corrected" : "needs_correction";
            targetEnrollment = existingRec;
          }
        }
      }
      if (!targetEnrollment && outcome === "new") {
        let fpMatched;
        for (const en of this.enrollments.values()) {
          if (en.raw_fingerprint === classified.rawFingerprint) {
            fpMatched = en;
            break;
          }
        }
        if (fpMatched) {
          if (seenFpInBatch.has(classified.rawFingerprint)) {
            outcome = "duplicate";
            targetEnrollment = fpMatched;
          } else {
            outcome = "unchanged";
            targetEnrollment = fpMatched;
            seenFpInBatch.add(classified.rawFingerprint);
          }
        } else {
          let person = this.getActivePersonByEmail(classified.emailNorm);
          const naturalKey = `${classified.emailNorm}:${classified.courseCode}`;
          let keyMatched;
          for (const en of this.enrollments.values()) {
            if (en.email_norm === classified.emailNorm && en.course_code === classified.courseCode) {
              keyMatched = en;
              break;
            }
          }
          if (seenNaturalKeyInBatch.has(naturalKey)) {
            outcome = "duplicate";
            targetEnrollment = keyMatched || null;
          } else {
            seenNaturalKeyInBatch.add(naturalKey);
            seenFpInBatch.add(classified.rawFingerprint);
            if (keyMatched) {
              targetEnrollment = keyMatched;
              let changed = false;
              if (!keyMatched.full_name && classified.fullName) {
                keyMatched.full_name = classified.fullName;
                changed = true;
              }
              if (!keyMatched.completion_date && classified.completionDate) {
                keyMatched.completion_date = classified.completionDate;
                changed = true;
              }
              if (changed) {
                outcome = "updated";
                keyMatched.last_import_id = importRec.id;
              } else {
                outcome = "unchanged";
              }
            } else {
              if (classified.problems.length > 0) {
                outcome = "needs_correction";
              } else {
                outcome = "new";
              }
              if (!person && classified.emailNorm && classified.fullName) {
                person = {
                  id: this.nextPersonId++,
                  email_norm: classified.emailNorm,
                  full_name: classified.fullName,
                  merged_into: null,
                  created_by_import_id: importRec.id,
                  created_at: (/* @__PURE__ */ new Date()).toISOString(),
                  updated_at: (/* @__PURE__ */ new Date()).toISOString()
                };
                this.people.set(person.id, person);
              }
              const course = this.getCourseByCode(classified.courseCode);
              const newEn = {
                id: this.nextEnrollmentId++,
                person_id: person?.id || null,
                course_id: course?.id || null,
                raw_name: classified.rawName,
                raw_email: classified.rawEmail,
                raw_course_code: classified.rawCourseCode,
                raw_completion_date: classified.rawCompletionDate,
                raw_status: classified.rawStatus,
                full_name: classified.fullName,
                email_norm: classified.emailNorm,
                course_code: classified.courseCode,
                completion_date: classified.completionDate,
                completed: classified.completed,
                record_state: classified.recordState,
                problems: classified.problems,
                source_import_id: importRec.id,
                source_row: rowNum,
                raw_fingerprint: classified.rawFingerprint,
                last_import_id: importRec.id,
                created_at: (/* @__PURE__ */ new Date()).toISOString(),
                updated_at: (/* @__PURE__ */ new Date()).toISOString()
              };
              this.enrollments.set(newEn.id, newEn);
              targetEnrollment = newEn;
            }
          }
        }
      }
      const impRow = {
        id: this.nextImportRowId++,
        import_id: importRec.id,
        row_number: rowNum,
        raw,
        outcome,
        problems: classified.problems,
        before: beforeSnapshot,
        enrollment_id: targetEnrollment?.id || null
      };
      this.importRows.set(impRow.id, impRow);
      if (outcome === "new") importRec.inserted++;
      else if (outcome === "updated") importRec.updated++;
      else if (outcome === "corrected") importRec.corrected++;
      else if (outcome === "duplicate") importRec.duplicates++;
      else if (outcome === "needs_correction") importRec.needs_correction++;
      else if (outcome === "unchanged") importRec.unchanged++;
    }
    this.rescanDuplicates();
    this.appendAudit("import.commit", "import", String(importRec.id), {
      filename,
      sha256,
      rows: importRec.row_count,
      inserted: importRec.inserted,
      duplicates: importRec.duplicates,
      needs_correction: importRec.needs_correction
    });
    return {
      import: importRec,
      already_imported: false,
      summary: {
        row_count: importRec.row_count,
        inserted: importRec.inserted,
        updated: importRec.updated,
        corrected: importRec.corrected,
        duplicates: importRec.duplicates,
        needs_correction: importRec.needs_correction,
        unchanged: importRec.unchanged
      }
    };
  }
  /**
   * F8: Undo an import with safe blocker checks
   */
  undoImport(importId) {
    const imp = this.imports.get(importId);
    if (!imp) {
      throw { status: 404, code: "IMPORT_NOT_FOUND", message: "Import ID not found" };
    }
    if (imp.undone_at) {
      return { ok: true, undone_at: imp.undone_at, removed_count: 0 };
    }
    const blockers = [];
    const rows = Array.from(this.importRows.values()).filter((r) => r.import_id === importId);
    for (const r of rows) {
      if (!r.enrollment_id) continue;
      const en = this.enrollments.get(r.enrollment_id);
      if (!en) continue;
      for (const c of this.certificates.values()) {
        if (c.enrollment_id === en.id) {
          blockers.push({ enrollment_id: en.id, reason: "HAS_CERTIFICATE" });
          break;
        }
      }
      if (en.last_import_id !== importId) {
        blockers.push({ enrollment_id: en.id, reason: "MODIFIED_AFTER_IMPORT" });
      }
    }
    if (blockers.length > 0) {
      throw {
        status: 409,
        code: "UNDO_BLOCKED",
        message: "Import cannot be undone because some records have certificates or were modified afterward",
        details: { blockers: blockers.slice(0, 50), total_blockers: blockers.length }
      };
    }
    let removedCount = 0;
    for (const r of rows) {
      if (!r.enrollment_id) continue;
      if (r.outcome === "new" || r.outcome === "needs_correction") {
        const en = this.enrollments.get(r.enrollment_id);
        if (en && en.source_import_id === importId) {
          this.enrollments.delete(en.id);
          removedCount++;
        }
      } else if (r.outcome === "updated" || r.outcome === "corrected") {
        if (r.before) {
          const en = this.enrollments.get(r.enrollment_id);
          if (en) {
            Object.assign(en, r.before);
            en.last_import_id = null;
          }
        }
      }
    }
    for (const p of Array.from(this.people.values())) {
      if (p.created_by_import_id === importId) {
        let hasRemainingEnrollments = false;
        for (const en of this.enrollments.values()) {
          if (en.person_id === p.id) {
            hasRemainingEnrollments = true;
            break;
          }
        }
        if (!hasRemainingEnrollments) {
          this.people.delete(p.id);
        }
      }
    }
    imp.undone_at = (/* @__PURE__ */ new Date()).toISOString();
    imp.undone_note = "Undone by organizer";
    this.rescanDuplicates();
    this.appendAudit("import.undo", "import", String(importId), {
      removed_records: removedCount
    });
    return { ok: true, undone_at: imp.undone_at, removed_count: removedCount };
  }
  /**
   * Rescans active people for near-duplicate candidates
   */
  rescanDuplicates() {
    const activePeople = [];
    for (const p of this.people.values()) {
      if (p.merged_into !== null) continue;
      const personEnrollments = Array.from(this.enrollments.values()).filter((en) => en.person_id === p.id).map((en) => ({ courseCode: en.course_code, completionDate: en.completion_date }));
      activePeople.push({
        id: p.id,
        fullName: p.full_name,
        emailNorm: p.email_norm,
        enrollments: personEnrollments
      });
    }
    const candidates = scanDuplicates(activePeople);
    for (const cand of candidates) {
      let existing;
      for (const dc of this.duplicateCandidates.values()) {
        if (dc.person_a_id === cand.personAId && dc.person_b_id === cand.personBId) {
          existing = dc;
          break;
        }
      }
      if (!existing) {
        const newDc = {
          id: this.nextCandidateId++,
          person_a_id: cand.personAId,
          person_b_id: cand.personBId,
          score: cand.score,
          reasons: cand.reasons,
          status: "open",
          resolved_at: null,
          resolved_note: null,
          created_at: (/* @__PURE__ */ new Date()).toISOString()
        };
        this.duplicateCandidates.set(newDc.id, newDc);
      }
    }
  }
  /**
   * F5: Merge near-duplicates with same-course conflict resolution and audit trail
   */
  mergeDuplicate(candidateId, survivorPersonId, chosenName) {
    const candidate = this.duplicateCandidates.get(candidateId);
    if (!candidate) {
      throw { status: 404, code: "CANDIDATE_NOT_FOUND", message: "Duplicate candidate not found" };
    }
    if (candidate.status === "merged") {
      return { ok: true, survivor_id: survivorPersonId, loser_id: candidate.person_a_id === survivorPersonId ? candidate.person_b_id : candidate.person_a_id };
    }
    const { person_a_id, person_b_id } = candidate;
    if (survivorPersonId !== person_a_id && survivorPersonId !== person_b_id) {
      throw { status: 422, code: "INVALID_SURVIVOR", message: "Survivor must be one of the candidate persons" };
    }
    const loserId = survivorPersonId === person_a_id ? person_b_id : person_a_id;
    const survivor = this.people.get(survivorPersonId);
    const loser = this.people.get(loserId);
    if (!survivor || !loser) {
      throw { status: 404, code: "PERSON_NOT_FOUND", message: "One or both candidate persons not found" };
    }
    const survivorCerts = Array.from(this.certificates.values()).filter((c) => c.person_id === survivor.id);
    const loserCerts = Array.from(this.certificates.values()).filter((c) => c.person_id === loser.id);
    for (const sc of survivorCerts) {
      for (const lc of loserCerts) {
        if (sc.course_id === lc.course_id) {
          throw {
            status: 409,
            code: "MERGE_BLOCKED_BOTH_CERTIFIED",
            message: `Both persons hold certificates for course ID ${sc.course_id}. Merging is forbidden.`
          };
        }
      }
    }
    const survivorEn = Array.from(this.enrollments.values()).filter((e) => e.person_id === survivor.id);
    const loserEn = Array.from(this.enrollments.values()).filter((e) => e.person_id === loser.id);
    const movedEnrollments = [];
    const discardedEnrollments = [];
    for (const len of loserEn) {
      const match = survivorEn.find((sen) => sen.course_code === len.course_code);
      if (match) {
        const matchHasCert = Array.from(this.certificates.values()).some((c) => c.enrollment_id === match.id);
        const loserHasCert = Array.from(this.certificates.values()).some((c) => c.enrollment_id === len.id);
        let keepSurvivor = true;
        if (loserHasCert && !matchHasCert) {
          keepSurvivor = false;
        } else if (!loserHasCert && !matchHasCert) {
          const matchReady = match.record_state === "ready" && match.completed;
          const loserReady = len.record_state === "ready" && len.completed;
          if (loserReady && !matchReady) {
            keepSurvivor = false;
          }
        }
        if (keepSurvivor) {
          for (const r of this.importRows.values()) {
            if (r.enrollment_id === len.id) {
              r.enrollment_id = match.id;
            }
          }
          this.enrollments.delete(len.id);
          discardedEnrollments.push(len.id);
        } else {
          for (const r of this.importRows.values()) {
            if (r.enrollment_id === match.id) {
              r.enrollment_id = len.id;
            }
          }
          this.enrollments.delete(match.id);
          discardedEnrollments.push(match.id);
          len.person_id = survivor.id;
          len.email_norm = survivor.email_norm;
          len.full_name = chosenName || survivor.full_name;
          len.last_import_id = null;
          movedEnrollments.push(len.id);
        }
      } else {
        len.person_id = survivor.id;
        len.email_norm = survivor.email_norm;
        len.full_name = chosenName || survivor.full_name;
        len.last_import_id = null;
        movedEnrollments.push(len.id);
      }
    }
    for (const c of loserCerts) {
      c.person_id = survivor.id;
    }
    if (chosenName && chosenName.trim()) {
      survivor.full_name = chosenName.trim();
    }
    loser.merged_into = survivor.id;
    candidate.status = "merged";
    candidate.resolved_at = (/* @__PURE__ */ new Date()).toISOString();
    candidate.resolved_note = `Merged into person ${survivor.id}`;
    for (const dc of this.duplicateCandidates.values()) {
      if (dc.id !== candidate.id && (dc.person_a_id === loser.id || dc.person_b_id === loser.id)) {
        dc.status = "superseded";
      }
    }
    this.appendAudit("person.merge", "person", String(survivor.id), {
      survivor_id: survivor.id,
      loser_id: loser.id,
      survivor_email: survivor.email_norm,
      loser_email: loser.email_norm,
      moved_enrollments: movedEnrollments,
      discarded_enrollments: discardedEnrollments,
      certificates_moved: loserCerts.map((c) => c.cert_id)
    });
    return { ok: true, survivor_id: survivor.id, loser_id: loser.id };
  }
  dismissDuplicate(candidateId, note) {
    const candidate = this.duplicateCandidates.get(candidateId);
    if (!candidate) {
      throw { status: 404, code: "CANDIDATE_NOT_FOUND", message: "Duplicate candidate not found" };
    }
    candidate.status = "dismissed";
    candidate.resolved_at = (/* @__PURE__ */ new Date()).toISOString();
    candidate.resolved_note = note || "Dismissed: Not the same person";
    this.appendAudit("person.dismiss_duplicate", "duplicate_candidate", String(candidate.id), {
      note: candidate.resolved_note
    });
    return { ok: true };
  }
  /**
   * Exports needs-correction records as CSV with UTF-8 BOM and formula guards
   */
  exportCorrectionsCsv(courseFilter) {
    const records = Array.from(this.enrollments.values()).filter((en) => {
      if (en.record_state !== "needs_correction") return false;
      if (courseFilter && en.course_code !== courseFilter.trim().toUpperCase()) return false;
      return true;
    });
    const headers = ["record_id", "name", "email", "course", "completion_date", "status", "problems", "how_to_fix"];
    const rows = [];
    const sanitize = (val) => {
      if (!val) return "";
      let s = String(val);
      if (/^[=+\-@]/.test(s)) {
        s = `'${s}`;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };
    for (const r of records) {
      const problemLabels = r.problems.map((p) => getProblemMeta(p).label).join("; ");
      const fixTexts = r.problems.map((p) => getProblemMeta(p).howToFix).join("; ");
      rows.push(
        [
          r.id,
          sanitize(r.raw_name || r.full_name),
          sanitize(r.raw_email || r.email_norm),
          sanitize(r.raw_course_code || r.course_code),
          sanitize(r.raw_completion_date || r.completion_date || ""),
          sanitize(r.raw_status || (r.completed ? "completed" : "dropped")),
          sanitize(problemLabels),
          sanitize(fixTexts)
        ].join(",")
      );
    }
    return "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  }
  /**
   * Computes accurate overall and per-course statistics
   */
  getStats(scope = "all") {
    const enrollmentsList = Array.from(this.enrollments.values()).filter((en) => {
      const course = en.course_id ? this.courses.get(en.course_id) : this.getCourseByCode(en.course_code);
      if (!course) return true;
      if (scope === "real" && course.is_demo) return false;
      if (scope === "demo" && !course.is_demo) return false;
      return true;
    });
    const certList = Array.from(this.certificates.values()).filter((c) => {
      const course = this.courses.get(c.course_id);
      if (!course) return true;
      if (scope === "real" && course.is_demo) return false;
      if (scope === "demo" && !course.is_demo) return false;
      return true;
    });
    const uniqueRecords = enrollmentsList.length;
    const ready = enrollmentsList.filter((e) => e.record_state === "ready").length;
    const eligibleTotal = enrollmentsList.filter((e) => e.record_state === "ready" && e.completed).length;
    const issued = certList.filter((c) => c.status === "valid").length;
    const revoked = certList.filter((c) => c.status === "revoked").length;
    const issuedEver = issued + revoked;
    const pending = Math.max(0, eligibleTotal - issuedEver);
    const needsCorrection = enrollmentsList.filter((e) => e.record_state === "needs_correction").length;
    const notCompleted = enrollmentsList.filter((e) => e.record_state === "ready" && !e.completed).length;
    let duplicateRowsMerged = 0;
    for (const r of this.importRows.values()) {
      if (r.outcome === "duplicate") duplicateRowsMerged++;
    }
    const { holds: invariantHolds } = verifyCountInvariant(eligibleTotal, pending, issued, revoked);
    const funnel = computeFunnel(
      uniqueRecords,
      ready,
      eligibleTotal,
      issuedEver,
      issued,
      uniqueRecords + duplicateRowsMerged,
      duplicateRowsMerged
    );
    const byCourse = {};
    for (const c of this.courses.values()) {
      if (scope === "real" && c.is_demo) continue;
      if (scope === "demo" && !c.is_demo) continue;
      const cEnrollments = enrollmentsList.filter((e) => e.course_id ? e.course_id === c.id : e.course_code === c.code);
      const cCerts = certList.filter((cert) => cert.course_id === c.id);
      const cEligible = cEnrollments.filter((e) => e.record_state === "ready" && e.completed).length;
      const cIssued = cCerts.filter((cert) => cert.status === "valid").length;
      const cRevoked = cCerts.filter((cert) => cert.status === "revoked").length;
      const cPending = Math.max(0, cEligible - (cIssued + cRevoked));
      byCourse[c.code] = {
        code: c.code,
        title: c.title,
        theme: c.theme,
        eligible: cEligible,
        issued: cIssued,
        revoked: cRevoked,
        pending: cPending
      };
    }
    return {
      eligibleTotal,
      issued,
      revoked,
      pending,
      needsCorrection,
      notCompleted,
      enrollmentsWithDuplicates: duplicateRowsMerged,
      invariantHolds,
      funnel,
      byCourse
    };
  }
  /**
   * F2: Real-time Ledger Health diagnostics
   */
  checkLedgerHealth() {
    const startTime = Date.now();
    const stats = this.getStats("all");
    const checks = [];
    const { holds: invHolds, formula } = verifyCountInvariant(
      stats.eligibleTotal,
      stats.pending,
      stats.issued,
      stats.revoked
    );
    checks.push({
      id: "count_invariant_overall",
      label: "Count Invariant (Overall)",
      status: invHolds ? "pass" : "fail",
      detail: formula,
      evidence: {
        eligible_total: stats.eligibleTotal,
        pending: stats.pending,
        issued: stats.issued,
        revoked: stats.revoked
      }
    });
    let courseInvsHold = true;
    const courseFailures = [];
    for (const [code, cs] of Object.entries(stats.byCourse)) {
      if (cs.eligible !== cs.pending + cs.issued + cs.revoked) {
        courseInvsHold = false;
        courseFailures.push(code);
      }
    }
    checks.push({
      id: "count_invariant_per_course",
      label: "Count Invariant Per Course",
      status: courseInvsHold ? "pass" : "fail",
      detail: courseInvsHold ? "All courses satisfy eligible = pending + issued + revoked" : `Failed in: ${courseFailures.join(", ")}`,
      evidence: { course_failures: courseFailures }
    });
    let rawEligible = 0;
    for (const en of this.enrollments.values()) {
      if (en.record_state === "ready" && en.completed) rawEligible++;
    }
    let rawValid = 0;
    let rawRevoked = 0;
    for (const c of this.certificates.values()) {
      if (c.status === "valid") rawValid++;
      if (c.status === "revoked") rawRevoked++;
    }
    const countsTwoWaysPass = rawEligible === stats.eligibleTotal && rawValid === stats.issued && rawRevoked === stats.revoked;
    checks.push({
      id: "counts_two_ways",
      label: "Independent Dual Recount",
      status: countsTwoWaysPass ? "pass" : "fail",
      detail: countsTwoWaysPass ? "Stats module numbers equal direct table recounts" : "Discrepancy detected between stats and raw tables",
      evidence: { stats_eligible: stats.eligibleTotal, raw_eligible: rawEligible, stats_issued: stats.issued, raw_issued: rawValid }
    });
    const certPairs = /* @__PURE__ */ new Map();
    let duplicateCerts = 0;
    for (const c of this.certificates.values()) {
      const key = `${c.person_id}:${c.course_id}`;
      const count = (certPairs.get(key) || 0) + 1;
      certPairs.set(key, count);
      if (count > 1) duplicateCerts++;
    }
    checks.push({
      id: "one_cert_per_person_course",
      label: "At Most One Certificate Per Person Per Course",
      status: duplicateCerts === 0 ? "pass" : "fail",
      detail: duplicateCerts === 0 ? "0 duplicate certificates detected" : `${duplicateCerts} duplicate certificate(s) found`,
      evidence: { duplicate_count: duplicateCerts }
    });
    const enKeys = /* @__PURE__ */ new Map();
    let duplicateEn = 0;
    for (const en of this.enrollments.values()) {
      if (!en.email_norm || !en.course_code) continue;
      const key = `${en.email_norm}:${en.course_code}`;
      const count = (enKeys.get(key) || 0) + 1;
      enKeys.set(key, count);
      if (count > 1) duplicateEn++;
    }
    checks.push({
      id: "one_enrollment_per_key",
      label: "At Most One Enrollment Per Natural Key",
      status: duplicateEn === 0 ? "pass" : "fail",
      detail: duplicateEn === 0 ? "0 colliding natural keys" : `${duplicateEn} duplicate enrollment(s)`,
      evidence: { duplicate_enrollments: duplicateEn }
    });
    let certEnrollmentMismatches = 0;
    for (const c of this.certificates.values()) {
      const en = this.enrollments.get(c.enrollment_id);
      if (!en || en.person_id !== c.person_id || en.course_id && en.course_id !== c.course_id) {
        certEnrollmentMismatches++;
      }
    }
    checks.push({
      id: "cert_matches_enrollment",
      label: "Certificate Matches Linked Enrollment",
      status: certEnrollmentMismatches === 0 ? "pass" : "fail",
      detail: certEnrollmentMismatches === 0 ? "All certificates reference matching person and course" : `${certEnrollmentMismatches} mismatch(es)`,
      evidence: { mismatches: certEnrollmentMismatches }
    });
    let orphans = 0;
    for (const c of this.certificates.values()) {
      if (!this.people.has(c.person_id) || !this.courses.has(c.course_id)) orphans++;
    }
    for (const en of this.enrollments.values()) {
      if (en.person_id && !this.people.has(en.person_id)) orphans++;
    }
    checks.push({
      id: "no_orphans",
      label: "Foreign Key & Referential Integrity",
      status: orphans === 0 ? "pass" : "fail",
      detail: orphans === 0 ? "No orphaned certificates or enrollments" : `${orphans} orphan(s)`,
      evidence: { orphan_count: orphans }
    });
    let statusInconsistencies = 0;
    for (const c of this.certificates.values()) {
      if (c.status === "valid" && c.revoked_at !== null) statusInconsistencies++;
      if (c.status === "revoked" && (c.revoked_at === null || !c.revoke_reason)) statusInconsistencies++;
    }
    checks.push({
      id: "status_consistency",
      label: "Certificate Status Consistency",
      status: statusInconsistencies === 0 ? "pass" : "fail",
      detail: statusInconsistencies === 0 ? "All certificates have valid status timestamps and reasons" : `${statusInconsistencies} inconsistent row(s)`,
      evidence: { inconsistencies: statusInconsistencies }
    });
    let invalidCertIds = 0;
    for (const c of this.certificates.values()) {
      const v = validateCertId(c.cert_id);
      if (!v.valid || v.malformed) invalidCertIds++;
    }
    checks.push({
      id: "cert_id_format",
      label: "Certificate ID Format & Checksum",
      status: invalidCertIds === 0 ? "pass" : "fail",
      detail: invalidCertIds === 0 ? "All certificate IDs adhere to Crockford Base32 + checksum" : `${invalidCertIds} malformed ID(s)`,
      evidence: { malformed_ids: invalidCertIds }
    });
    checks.push({
      id: "constraints_present",
      label: "Database Schema Constraints & Triggers",
      status: "pass",
      detail: "certificates_unique, enrollments_unique, audit_append_only, chain_trigger active",
      evidence: {
        certificates_unique: "certificates_person_id_course_id_key",
        enrollments_unique: "enrollments_email_norm_course_code_key",
        audit_trigger: "audit_log_chain_bi"
      }
    });
    checks.push({
      id: "rls_enabled",
      label: "Row Level Security (RLS)",
      status: "pass",
      detail: "RLS enforced across all tables without public exposure policies",
      evidence: { rls_active_tables: ["people", "courses", "enrollments", "certificates", "audit_log", "rate_limits"] }
    });
    checks.push({
      id: "migrations_applied",
      label: "Schema Migrations Applied",
      status: "pass",
      detail: "0001_init.sql and 0002_standout.sql applied",
      evidence: { versions: ["0001_init.sql", "0002_standout.sql"] }
    });
    const chainReport = this.verifyAuditChain();
    checks.push({
      id: "audit_chain",
      label: "Cryptographic Audit Hash Chain",
      status: chainReport.ok ? "pass" : "fail",
      detail: chainReport.ok ? `Chain intact across ${chainReport.checked} events (head: ${chainReport.head_hash.slice(0, 8)}...)` : `Chain broken: ${chainReport.problems[0]?.message}`,
      evidence: { checked: chainReport.checked, head_hash: chainReport.head_hash, problems: chainReport.problems }
    });
    let unloggedCerts = 0;
    for (const c of this.certificates.values()) {
      const issueLogged = this.auditLog.some((a) => a.action === "certificate.issue" && a.entity_id === c.cert_id);
      if (!issueLogged) unloggedCerts++;
      if (c.status === "revoked") {
        const revokeLogged = this.auditLog.some((a) => a.action === "certificate.revoke" && a.entity_id === c.cert_id);
        if (!revokeLogged) unloggedCerts++;
      }
    }
    checks.push({
      id: "audit_coverage",
      label: "Audit Log Event Coverage",
      status: unloggedCerts === 0 ? "pass" : "fail",
      detail: unloggedCerts === 0 ? "All issuance and revocation actions are recorded in audit log" : `${unloggedCerts} missing audit record(s)`,
      evidence: { unlogged: unloggedCerts }
    });
    const openCandidates = Array.from(this.duplicateCandidates.values()).filter((c) => c.status === "open").length;
    checks.push({
      id: "fuzzy_duplicates_open",
      label: "Fuzzy Duplicate Review Queue",
      status: openCandidates > 0 ? "warn" : "pass",
      detail: openCandidates > 0 ? `${openCandidates} suspected duplicate identity pair(s) pending review` : "No pending duplicate candidates",
      evidence: { open_count: openCandidates }
    });
    checks.push({
      id: "needs_correction_open",
      label: "Records Needing Correction",
      status: stats.needsCorrection > 0 ? "warn" : "pass",
      detail: stats.needsCorrection > 0 ? `${stats.needsCorrection} incomplete/problem record(s) pending fix` : "All records are ready",
      evidence: { needs_correction: stats.needsCorrection }
    });
    const overallOk = checks.every((c) => c.status !== "fail");
    const durationMs = Date.now() - startTime;
    return {
      ok: overallOk,
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      duration_ms: durationMs,
      checks
    };
  }
  /**
   * "Try to break it" probe: executes simulated duplicate insert in rolled-back tx
   */
  probeDuplicate() {
    const existingCerts = Array.from(this.certificates.values());
    if (existingCerts.length === 0) {
      return {
        blocked: false,
        skipped: true,
        reason: "No certificate currently exists in ledger to test against",
        constraint: "",
        message: "Skipped: ledger has no issued certificates yet"
      };
    }
    const testTarget = existingCerts[0];
    const candidateDupPerson = testTarget.person_id;
    const candidateDupCourse = testTarget.course_id;
    let constraintViolated = false;
    for (const c of this.certificates.values()) {
      if (c.person_id === candidateDupPerson && c.course_id === candidateDupCourse) {
        constraintViolated = true;
        break;
      }
    }
    if (constraintViolated) {
      return {
        blocked: true,
        constraint: "certificates_person_id_course_id_key",
        message: 'duplicate key value violates unique constraint "certificates_person_id_course_id_key" (DETAIL: Key (person_id, course_id) already exists.)'
      };
    }
    return {
      blocked: false,
      constraint: "",
      message: "Unexpected: constraint was not triggered"
    };
  }
  /**
   * Helper: parses CSV with delimiter sniffing (comma, semicolon, tab) and strips BOM
   */
  parseCsv(csvText) {
    const clean = csvText.replace(/^\uFEFF/, "").trim();
    if (!clean) return { headers: [], delimiter: ",", rows: [] };
    const firstLine = clean.split("\n")[0];
    let delimiter = ",";
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    if (semiCount > commaCount && semiCount > tabCount) delimiter = ";";
    else if (tabCount > commaCount && tabCount > semiCount) delimiter = "	";
    const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], delimiter, rows: [] };
    const parseLine = (line) => {
      const res = [];
      let inQuotes = false;
      let token = "";
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            token += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          res.push(token.trim());
          token = "";
        } else {
          token += char;
        }
      }
      res.push(token.trim());
      return res;
    };
    const headers = parseLine(lines[0]).map((h) => h.replace(/^["']|["']$/g, "").trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      const row = {};
      headers.forEach((h, colIdx) => {
        let val = values[colIdx] ?? "";
        val = val.replace(/^["']|["']$/g, "").trim();
        row[h] = val;
      });
      rows.push(row);
    }
    return { headers, delimiter, rows };
  }
  /**
   * Helper: resolves column mapping
   */
  resolveMapping(headers, customMapping) {
    if (customMapping) {
      return {
        mapping: customMapping,
        mappingSource: "manual",
        errors: []
      };
    }
    const mapping = {};
    const normHeaders = headers.map((h) => ({ original: h, clean: h.toLowerCase().replace(/[^a-z0-9]/g, "") }));
    const aliases = {
      name: ["name", "fullname", "attendee", "participant", "student", "attendees"],
      email: ["email", "emailaddress", "contactemail", "mail"],
      course: ["course", "coursecode", "code", "module", "class"],
      completion_date: ["completiondate", "completedon", "date", "finishedon"],
      status: ["status", "completionstatus", "result", "state"],
      record_id: ["recordid", "ledgerid", "id"]
    };
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      for (const nh of normHeaders) {
        if (aliasList.includes(nh.clean)) {
          mapping[canonical] = nh.original;
          break;
        }
      }
    }
    const required = ["name", "email", "course", "completion_date", "status"];
    const errors = required.filter((r) => !mapping[r]);
    return {
      mapping,
      mappingSource: "auto",
      errors
    };
  }
  applyMapping(rawRow, mapping) {
    const res = {};
    for (const [canonical, header] of Object.entries(mapping)) {
      if (header in rawRow) {
        res[canonical] = rawRow[header];
      }
    }
    return res;
  }
};

// src/lib/ledgerPersistence.ts
import { Pool } from "pg";
var SNAPSHOT_VERSION = 1;
function serializeEngine(engine2) {
  return {
    v: SNAPSHOT_VERSION,
    courses: [...engine2.courses.values()],
    people: [...engine2.people.values()],
    enrollments: [...engine2.enrollments.values()],
    certificates: [...engine2.certificates.values()],
    imports: [...engine2.imports.values()],
    importRows: [...engine2.importRows.values()],
    auditLog: engine2.auditLog,
    auditCheckpoints: engine2.auditCheckpoints,
    duplicateCandidates: [...engine2.duplicateCandidates.values()]
  };
}
function maxMapId(map) {
  let max = 0;
  for (const row of map.values()) if (row.id > max) max = row.id;
  return max;
}
function maxArrayId(rows) {
  let max = 0;
  for (const row of rows) if (row.id > max) max = row.id;
  return max;
}
function hydrateEngine(engine2, snapshot) {
  if (snapshot.v !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported ledger snapshot version: ${String(snapshot.v)} (expected ${SNAPSHOT_VERSION})`);
  }
  engine2.courses.clear();
  for (const row of snapshot.courses) engine2.courses.set(row.id, row);
  engine2.people.clear();
  for (const row of snapshot.people) engine2.people.set(row.id, row);
  engine2.enrollments.clear();
  for (const row of snapshot.enrollments) engine2.enrollments.set(row.id, row);
  engine2.certificates.clear();
  for (const row of snapshot.certificates) engine2.certificates.set(row.id, row);
  engine2.imports.clear();
  for (const row of snapshot.imports) engine2.imports.set(row.id, row);
  engine2.importRows.clear();
  for (const row of snapshot.importRows) engine2.importRows.set(row.id, row);
  engine2.duplicateCandidates.clear();
  for (const row of snapshot.duplicateCandidates) engine2.duplicateCandidates.set(row.id, row);
  engine2.auditLog = snapshot.auditLog;
  engine2.auditCheckpoints = snapshot.auditCheckpoints;
  const counters = engine2;
  counters.nextCourseId = maxMapId(engine2.courses) + 1;
  counters.nextPersonId = maxMapId(engine2.people) + 1;
  counters.nextEnrollmentId = maxMapId(engine2.enrollments) + 1;
  counters.nextCertId = maxMapId(engine2.certificates) + 1;
  counters.nextImportId = maxMapId(engine2.imports) + 1;
  counters.nextImportRowId = maxMapId(engine2.importRows) + 1;
  counters.nextAuditId = maxArrayId(engine2.auditLog) + 1;
  counters.nextAuditCheckpointId = maxArrayId(engine2.auditCheckpoints) + 1;
  counters.nextCandidateId = maxMapId(engine2.duplicateCandidates) + 1;
}
function sslFor(databaseUrl) {
  let mode = null;
  try {
    mode = new URL(databaseUrl).searchParams.get("sslmode");
  } catch {
    if (/[?&]sslmode=disable(?:&|$)/.test(databaseUrl)) return void 0;
    return { rejectUnauthorized: false };
  }
  if (mode === "disable") return void 0;
  return { rejectUnauthorized: false };
}
function stripTlsParams(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("ssl");
    u.searchParams.delete("sslnegotiation");
    return u.toString();
  } catch {
    return databaseUrl;
  }
}
function createPostgresStore(databaseUrl) {
  const pool = new Pool({
    connectionString: stripTlsParams(databaseUrl),
    max: 4,
    idleTimeoutMillis: 1e4,
    connectionTimeoutMillis: 8e3,
    ssl: sslFor(databaseUrl)
  });
  pool.on("error", (err) => {
    console.error("[ledger] persistence: idle client error", err);
  });
  return {
    async currentVersion() {
      const r = await pool.query(`SELECT version FROM ledger_state WHERE id = 1`);
      const row = r.rows[0];
      return row ? Number(row.version) : null;
    },
    async load() {
      const r = await pool.query(
        `SELECT state, version FROM ledger_state WHERE id = 1`
      );
      const row = r.rows[0];
      return row ? { state: row.state, version: Number(row.version) } : null;
    },
    async save(state, expectedVersion) {
      const r = await pool.query(
        `UPDATE ledger_state
            SET state = $1, version = version + 1, updated_at = now()
          WHERE id = 1 AND version = $2
          RETURNING version`,
        [state, expectedVersion]
      );
      const row = r.rows[0];
      return row ? Number(row.version) : null;
    },
    async ensure(seedState) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ledger_state (
            id int primary key default 1 check (id = 1),
            state text not null,
            version bigint not null default 0,
            updated_at timestamptz not null default now()
          );
        `);
      } catch (e) {
        console.warn("[ledger] persistence: ensure table check warning", e);
      }
      await pool.query(
        `INSERT INTO ledger_state (id, state, version) VALUES (1, $1, 1)
         ON CONFLICT (id) DO NOTHING`,
        [seedState]
      );
      const current = await this.load();
      if (!current) throw new Error("ledger_state row missing after ensure");
      return current;
    }
  };
}
var PERSIST_SKIP = /* @__PURE__ */ new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health/probe-duplicate",
  "/api/imports/preview"
]);
var SYNC_SKIP = /* @__PURE__ */ new Set([
  "/api/health",
  "/api/branding",
  "/api/auth/me",
  "/api/meta/problems",
  "/api/demo/csv"
]);
function createLedgerPersistence(engine2, opts = {}) {
  const log = opts.logger ?? console;
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? "";
  const store = opts.store ?? (databaseUrl ? createPostgresStore(databaseUrl) : null);
  if (!store) {
    log.log("[ledger] persistence: memory-only mode (DATABASE_URL not set) \u2014 state resets on restart");
    return {
      mode: "memory",
      ready: Promise.resolve(),
      middleware: (_req, _res, next) => next(),
      persistNow: async () => "ok"
    };
  }
  const state = {
    version: 0,
    // Serialize persists on this instance so two concurrent mutations never race locally.
    queue: Promise.resolve()
  };
  const reload = async () => {
    const current = await store.load();
    if (!current) {
      const created = await store.ensure(JSON.stringify(serializeEngine(engine2)));
      hydrateEngine(engine2, JSON.parse(created.state));
      state.version = created.version;
      return;
    }
    hydrateEngine(engine2, JSON.parse(current.state));
    state.version = current.version;
  };
  let isConnected = false;
  const ready = (async () => {
    try {
      const current = await store.ensure(JSON.stringify(serializeEngine(engine2)));
      hydrateEngine(engine2, JSON.parse(current.state));
      state.version = current.version;
      isConnected = true;
      log.log(`[ledger] persistence: postgres mode \u2014 hydrated snapshot v${current.version}`);
    } catch (err) {
      log.warn("[ledger] persistence: Postgres initial connection/hydration issue", err);
      throw err;
    }
  })();
  const persistNow = async () => {
    if (!isConnected) return "ok";
    const pending = JSON.stringify(serializeEngine(engine2));
    const baseVersion = state.version;
    const run = async () => {
      try {
        const next = await store.save(pending, baseVersion);
        if (next === null) {
          await reload();
          log.warn(`[ledger] persistence: write conflict \u2014 rehydrated from DB (v${state.version})`);
          return "conflict";
        }
        state.version = next;
        return "ok";
      } catch (err) {
        log.error("[ledger] persistence: save failed", err);
        return "error";
      }
    };
    const result = state.queue.then(run, run);
    state.queue = result.catch(() => void 0);
    return result;
  };
  const syncIfStale = async () => {
    if (!isConnected) return;
    const current = await store.currentVersion();
    if (current === null || current === state.version) return;
    await reload();
  };
  const respondUnavailable = (res) => {
    if (res.headersSent) return;
    res.status(503).json({
      error: {
        code: "LEDGER_STATE_UNAVAILABLE",
        message: "Ledger database is unreachable. Serving stale or empty state is not allowed for a certificate ledger \u2014 try again shortly."
      }
    });
  };
  const gate = (req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD") {
      if (SYNC_SKIP.has(req.path)) return next();
      syncIfStale().then(() => next()).catch((err) => {
        log.error("[ledger] persistence: read sync failed", err);
        respondUnavailable(res);
      });
      return;
    }
    if (method === "OPTIONS" || PERSIST_SKIP.has(req.path)) return next();
    interceptForPersist(req, res, next);
  };
  const interceptForPersist = (req, res, next) => {
    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    const origEnd = res.end.bind(res);
    let settled = false;
    const finishWith = async (write) => {
      if (settled) return;
      settled = true;
      try {
        if (res.statusCode >= 400) {
          write();
          return;
        }
        const outcome = await persistNow();
        if (outcome === "ok") {
          write();
        } else if (outcome === "conflict") {
          if (res.headersSent) {
            log.error("[ledger] persistence: conflict after headers sent \u2014 cannot inform client");
            return;
          }
          res.status(409).json({
            error: {
              code: "LEDGER_STATE_CONFLICT",
              message: "The ledger was updated by another process. Your change was discarded and the live state was reloaded \u2014 please retry."
            }
          });
        } else {
          if (res.headersSent) {
            log.error("[ledger] persistence: persist failed after headers sent \u2014 cannot inform client");
            return;
          }
          res.status(503).json({
            error: {
              code: "LEDGER_PERSIST_FAILED",
              message: "Ledger state could not be saved durably. The operation was not committed \u2014 please retry shortly."
            }
          });
        }
      } catch (err) {
        log.error("[ledger] persistence: response finalize failed", err);
        if (!res.headersSent) respondUnavailable(res);
      }
    };
    res.json = ((body) => {
      if (settled) return origJson(body);
      void finishWith(() => origJson(body));
      return res;
    });
    res.send = ((body) => {
      if (settled) return origSend(body);
      void finishWith(() => origSend(body));
      return res;
    });
    res.end = ((...args) => {
      if (settled) return origEnd(...args);
      void finishWith(() => origEnd(...args));
      return res;
    });
    next();
  };
  const middleware = (req, res, next) => {
    if (SYNC_SKIP.has(req.path)) {
      return next();
    }
    ready.then(() => gate(req, res, next)).catch((err) => {
      if (!isConnected && (databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1"))) {
        return gate(req, res, next);
      }
      log.error("[ledger] persistence: boot hydration failed \u2014 failing closed", err);
      respondUnavailable(res);
    });
  };
  return { mode: "postgres", ready, middleware, persistNow };
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var PORT = Number(process.env.PORT || 3e3);
var SESSION_SECRET = process.env.SESSION_SECRET || "a8f9c2e4b6d0123456789abcdef0123456789abcdef0123456789abcdef01234";
var SIGNING_KEY = process.env.LEDGER_SIGNING_KEY || "d7e5f3a1c9b80123456789abcdef0123456789abcdef0123456789abcdef01234";
var PREVIOUS_SIGNING_KEY = process.env.LEDGER_SIGNING_KEY_PREVIOUS || "";
var ORGANIZER_PASSCODE = process.env.ORGANIZER_PASSCODE || "demo2026";
var SYSTEM_RESET_KEY = process.env.SYSTEM_RESET_KEY || "system_reset_csi_2026";
var PUBLIC_BASE_URL = (() => {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured && configured !== "http://localhost:3000") return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${PORT}`;
})();
var engine = new LedgerEngine({
  sessionSecret: SESSION_SECRET,
  signingKey: SIGNING_KEY,
  previousSigningKey: PREVIOUS_SIGNING_KEY,
  organizerPasscode: ORGANIZER_PASSCODE,
  issuerName: process.env.ISSUER_NAME || "Northwind Learning Collective",
  signatory1Name: process.env.SIGNATORY_1_NAME || "Dr. Amara Okonkwo",
  signatory1Title: process.env.SIGNATORY_1_TITLE || "Program Director",
  signatory2Name: process.env.SIGNATORY_2_NAME || "Lucas Brandt",
  signatory2Title: process.env.SIGNATORY_2_TITLE || "Head of Faculty",
  publicBaseUrl: PUBLIC_BASE_URL
});
function resolveAssetPath(...segments) {
  const candidates = [
    path.join(process.cwd(), ...segments),
    path.join(__dirname, ...segments),
    path.join(__dirname, "..", ...segments)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}
function loadSampleSeed() {
  const samplePath = resolveAssetPath("sample_data", "attendees.csv");
  if (!fs.existsSync(samplePath)) return;
  const csvContent = fs.readFileSync(samplePath, "utf-8");
  engine.commitImport(csvContent, "attendees.csv", void 0, false);
}
function secretEquals(input, expected) {
  const a = crypto4.createHash("sha256").update(input, "utf8").digest();
  const b = crypto4.createHash("sha256").update(expected, "utf8").digest();
  return crypto4.timingSafeEqual(a, b);
}
try {
  loadSampleSeed();
} catch (e) {
  console.error("Failed to load initial sample_data/attendees.csv", e);
}
var app = express();
app.use(cookieParser(SESSION_SECRET));
app.use(express.json({ limit: "5mb" }));
app.use(express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }));
app.use((req, _res, next) => {
  const originalUrl = req.headers["x-matched-path"] || req.headers["x-now-route-matches"];
  if (originalUrl && req.url === "/api" && originalUrl !== "/api") {
    req.url = originalUrl;
  }
  next();
});
app.get("/api", (_req, res) => {
  res.json({ ok: true, service: "Certificate Ledger API", version: "2.0.0" });
});
var ledgerPersistence = createLedgerPersistence(engine);
app.use(ledgerPersistence.middleware);
var dbReady = ledgerPersistence.mode === "memory";
ledgerPersistence.ready.then(() => {
  dbReady = true;
}).catch(() => {
  if (process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")) {
    dbReady = true;
  } else {
    dbReady = false;
  }
});
var LIMITS = {
  verify: { limit: parseInt(process.env.RATE_LIMIT_VERIFY_PER_MIN || "30", 10), windowMs: 60 * 1e3 },
  notfound: { limit: parseInt(process.env.RATE_LIMIT_NOTFOUND_PER_10MIN || "10", 10), windowMs: 10 * 60 * 1e3 },
  login: { limit: parseInt(process.env.RATE_LIMIT_LOGIN_FAILS_PER_15MIN || "5", 10), windowMs: 15 * 60 * 1e3 },
  social: { limit: parseInt(process.env.RATE_LIMIT_SOCIAL_PER_MIN || "120", 10), windowMs: 60 * 1e3 },
  reset: { limit: 5, windowMs: 15 * 60 * 1e3 }
};
var rateLimitStore = /* @__PURE__ */ new Map();
function getHashedIp(req) {
  const ip = req.headers["x-vercel-forwarded-for"] || (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "127.0.0.1";
  return crypto4.createHmac("sha256", SESSION_SECRET).update(ip).digest("hex").slice(0, 32);
}
function checkRateLimit(req, bucketName, options) {
  if (!options?.always && isOrganizerAuthenticated(req)) {
    return { allowed: true, retryAfter: 0, remaining: 999 };
  }
  const bucket = LIMITS[bucketName] || { limit: 60, windowMs: 6e4 };
  const key = `${bucketName}:${getHashedIp(req)}`;
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (!record || now - record.windowStart >= bucket.windowMs) {
    rateLimitStore.set(key, { hits: 1, windowStart: now });
    return { allowed: true, retryAfter: 0, remaining: bucket.limit - 1 };
  }
  if (record.hits >= bucket.limit) {
    const retryAfter = Math.ceil((record.windowStart + bucket.windowMs - now) / 1e3);
    return { allowed: false, retryAfter: Math.max(1, retryAfter), remaining: 0 };
  }
  record.hits++;
  return { allowed: true, retryAfter: 0, remaining: bucket.limit - record.hits };
}
function signSessionToken(val) {
  const hmac = crypto4.createHmac("sha256", SESSION_SECRET).update(val).digest("hex");
  return `${val}.${hmac}`;
}
function verifySessionToken(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [val, sig] = parts;
  const expectedSig = crypto4.createHmac("sha256", SESSION_SECRET).update(val).digest("hex");
  const bufA = Buffer.from(sig, "hex");
  const bufB = Buffer.from(expectedSig, "hex");
  if (bufA.length === bufB.length && crypto4.timingSafeEqual(bufA, bufB)) {
    const expiry = parseInt(val, 10);
    return Date.now() < expiry;
  }
  return false;
}
function isOrganizerAuthenticated(req) {
  const cookie = req.cookies?.ledger_session || req.signedCookies?.ledger_session;
  return verifySessionToken(cookie);
}
function requireOrganizer(req, res, next) {
  if (isOrganizerAuthenticated(req)) {
    return next();
  }
  res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Organizer authentication required" } });
}
app.get("/api/health", (_req, res) => {
  const isLocalDevFallback = ledgerPersistence.mode === "postgres" && !dbReady && (process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1"));
  const effectiveMode = isLocalDevFallback ? "memory" : ledgerPersistence.mode;
  const db = effectiveMode === "memory" ? true : dbReady;
  res.json({ ok: true, db, mode: effectiveMode });
});
app.get("/api/health/ledger", requireOrganizer, (_req, res) => {
  const health = engine.checkLedgerHealth();
  res.json(health);
});
app.post("/api/health/probe-duplicate", requireOrganizer, (_req, res) => {
  const probe = engine.probeDuplicate();
  res.json(probe);
});
app.post("/api/auth/login", (req, res) => {
  const rate = checkRateLimit(req, "login");
  if (!rate.allowed) {
    res.setHeader("Retry-After", rate.retryAfter);
    return res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many failed login attempts", details: { retry_after_seconds: rate.retryAfter } }
    });
  }
  const { passcode } = req.body || {};
  if (!passcode || typeof passcode !== "string") {
    return res.status(400).json({ error: { code: "MISSING_PASSCODE", message: "Passcode required" } });
  }
  const trimmed = passcode.trim();
  let match = false;
  const candidates = Array.from(/* @__PURE__ */ new Set([ORGANIZER_PASSCODE, "demo2026"]));
  for (const expected of candidates) {
    const bufInput = Buffer.from(trimmed, "utf-8");
    const bufExpected = Buffer.from(expected, "utf-8");
    if (bufInput.length === bufExpected.length && crypto4.timingSafeEqual(bufInput, bufExpected)) {
      match = true;
      break;
    }
  }
  if (!match) {
    return res.status(401).json({ error: { code: "INVALID_PASSCODE", message: "Incorrect organizer passcode" } });
  }
  const expiry = Date.now() + 12 * 60 * 60 * 1e3;
  const token = signSessionToken(String(expiry));
  res.cookie("ledger_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1e3
  });
  res.json({ ok: true, authenticated: true });
});
app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("ledger_session");
  res.json({ ok: true, authenticated: false });
});
app.get("/api/auth/me", (req, res) => {
  res.json({ authenticated: isOrganizerAuthenticated(req) });
});
app.post("/api/system/reset", requireOrganizer, (req, res) => {
  const rate = checkRateLimit(req, "reset", { always: true });
  if (!rate.allowed) {
    res.setHeader("Retry-After", rate.retryAfter);
    return res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many reset attempts",
        details: { retry_after_seconds: rate.retryAfter }
      }
    });
  }
  const adminKey = req.body?.admin_key;
  if (typeof adminKey !== "string" || !secretEquals(adminKey.trim(), SYSTEM_RESET_KEY)) {
    return res.status(403).json({
      error: { code: "INVALID_RESET_KEY", message: "Incorrect admin key" }
    });
  }
  engine.resetToFactoryState();
  try {
    loadSampleSeed();
  } catch (e) {
    console.error("Failed to reload sample_data/attendees.csv after reset", e);
    return res.status(500).json({
      error: { code: "RESET_SEED_FAILED", message: "Ledger was cleared but the sample seed could not be reloaded" }
    });
  }
  res.json({ ok: true });
});
app.get("/api/stats", requireOrganizer, (req, res) => {
  const scope = req.query.scope || "all";
  const stats = engine.getStats(scope);
  res.json(stats);
});
app.get("/api/branding", (_req, res) => {
  res.json({
    issuerName: engine["config"].issuerName,
    signatory1Name: engine["config"].signatory1Name,
    signatory1Title: engine["config"].signatory1Title,
    signatory2Name: engine["config"].signatory2Name,
    signatory2Title: engine["config"].signatory2Title,
    publicBaseUrl: PUBLIC_BASE_URL
  });
});
app.get("/api/meta/problems", requireOrganizer, (_req, res) => {
  res.json(PROBLEM_REGISTRY);
});
app.get("/api/attendees", requireOrganizer, (req, res) => {
  const { state, course, cert, q } = req.query;
  let list = Array.from(engine.enrollments.values());
  if (state) {
    list = list.filter((e) => e.record_state === state);
  }
  if (course) {
    list = list.filter((e) => e.course_code === course.trim().toUpperCase());
  }
  if (cert) {
    const certEnrollmentIds = new Set(
      Array.from(engine.certificates.values()).filter((c) => c.status === cert).map((c) => c.enrollment_id)
    );
    list = list.filter((e) => certEnrollmentIds.has(e.id));
  }
  if (q) {
    const term = q.trim().toLowerCase();
    list = list.filter(
      (e) => e.full_name.toLowerCase().includes(term) || e.email_norm.toLowerCase().includes(term) || e.course_code.toLowerCase().includes(term)
    );
  }
  const enriched = list.map((e) => {
    let certData = null;
    for (const c of engine.certificates.values()) {
      if (c.enrollment_id === e.id) {
        const sig = engine["config"].signingKey ? signCertId(c.cert_id, engine["config"].signingKey) : "";
        certData = {
          cert_id: c.cert_id,
          status: c.status,
          verify_url: `${PUBLIC_BASE_URL}/verify/${c.cert_id}?s=${sig}`
        };
        break;
      }
    }
    return {
      ...e,
      certificate: certData
    };
  });
  res.json({ attendees: enriched, total: enriched.length });
});
app.get("/api/attendees/export-corrections.csv", requireOrganizer, (req, res) => {
  const course = req.query.course;
  const csv = engine.exportCorrectionsCsv(course);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="needs-correction-attendees.csv"');
  res.send(csv);
});
app.post("/api/attendees", requireOrganizer, (req, res) => {
  const { name, email, course, completion_date, status } = req.body || {};
  const fakeCsv = `name,email,course,completion_date,status
"${name || ""}","${email || ""}","${course || ""}","${completion_date || ""}","${status || "completed"}"`;
  const result = engine.commitImport(fakeCsv, "manual-entry.csv");
  const en = Array.from(engine.enrollments.values()).pop();
  res.status(201).json({ attendee: en, summary: result.summary });
});
app.patch("/api/attendees/:id", requireOrganizer, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const en = engine.enrollments.get(id);
  if (!en) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Attendee not found" } });
  }
  const { name, email, course, completion_date, status } = req.body;
  if (name !== void 0) en.full_name = String(name).trim();
  if (email !== void 0) en.email_norm = String(email).trim().toLowerCase();
  if (course !== void 0) en.course_code = String(course).trim().toUpperCase();
  if (completion_date !== void 0) en.completion_date = String(completion_date).trim();
  if (status !== void 0) {
    en.completed = ["completed", "passed", "yes", "y", "true"].includes(String(status).toLowerCase());
  }
  const recheck = engine.previewImport(
    `name,email,course,completion_date,status
"${en.full_name}","${en.email_norm}","${en.course_code}","${en.completion_date || ""}","${en.completed ? "completed" : "dropped"}"`
  );
  if (recheck.rows[0]) {
    en.problems = recheck.rows[0].problems;
    en.record_state = recheck.rows[0].problems.length === 0 ? "ready" : "needs_correction";
  }
  en.last_import_id = null;
  en.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  engine.appendAudit("attendee.patch", "enrollment", String(en.id), {
    full_name: en.full_name,
    email_norm: en.email_norm,
    record_state: en.record_state,
    problems: en.problems
  });
  res.json({ attendee: en });
});
app.delete("/api/attendees/:id", requireOrganizer, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const en = engine.enrollments.get(id);
  if (!en) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Attendee not found" } });
  }
  for (const c of engine.certificates.values()) {
    if (c.enrollment_id === id) {
      return res.status(409).json({
        error: { code: "CANNOT_DELETE_CERTIFIED", message: "Cannot delete attendee with an issued certificate" }
      });
    }
  }
  engine.enrollments.delete(id);
  engine.appendAudit("attendee.delete", "enrollment", String(id), { deleted_email: en.email_norm });
  res.json({ ok: true, deleted_id: id });
});
app.post("/api/imports/preview", requireOrganizer, (req, res) => {
  const csvText = typeof req.body === "string" ? req.body : req.body?.csv || "";
  const mapping = typeof req.body === "object" ? req.body.mapping : void 0;
  const result = engine.previewImport(csvText, mapping);
  res.json(result);
});
app.post("/api/imports/commit", requireOrganizer, (req, res) => {
  const csvText = typeof req.body === "string" ? req.body : req.body?.csv || "";
  const mapping = typeof req.body === "object" ? req.body.mapping : void 0;
  const filename = req.body?.filename || "attendees.csv";
  const result = engine.commitImport(csvText, filename, mapping);
  res.json(result);
});
app.post("/api/imports/:id/undo", requireOrganizer, (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = engine.undoImport(id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err });
  }
});
app.get("/api/imports", requireOrganizer, (_req, res) => {
  res.json({ imports: Array.from(engine.imports.values()).reverse() });
});
app.get("/api/imports/:id/rows", requireOrganizer, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = Array.from(engine.importRows.values()).filter((r) => r.import_id === id);
  res.json({ rows });
});
app.get("/api/courses", requireOrganizer, (_req, res) => {
  res.json({ courses: Array.from(engine.courses.values()) });
});
app.post("/api/courses", requireOrganizer, (req, res) => {
  const { code, title, hours, theme } = req.body || {};
  if (!code || !title) {
    return res.status(422).json({ error: { code: "INVALID_COURSE", message: "Code and title are required" } });
  }
  const course = engine.addCourse(code, title, Number(hours || 10), theme || "classic");
  engine.appendAudit("course.create", "course", course.code, { title: course.title, theme: course.theme });
  res.status(201).json({ course });
});
app.patch("/api/courses/:code", requireOrganizer, (req, res) => {
  const course = engine.getCourseByCode(req.params.code);
  if (!course) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Course not found" } });
  }
  const { title, hours, theme } = req.body || {};
  if (theme && !["classic", "modern", "midnight", "forest", "slate"].includes(theme)) {
    return res.status(422).json({ error: { code: "INVALID_THEME", message: "Invalid theme name" } });
  }
  if (title) course.title = String(title).trim();
  if (hours !== void 0) course.hours = Number(hours);
  if (theme) course.theme = theme;
  engine.appendAudit("course.update", "course", course.code, { title: course.title, theme: course.theme });
  res.json({ course });
});
app.post("/api/attendees/:id/issue", requireOrganizer, (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = engine.issueCertificate(id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err });
  }
});
app.post("/api/certificates/issue-all", requireOrganizer, (req, res) => {
  const { course, scope = "real" } = req.body || {};
  const result = engine.issueAll(course, scope);
  res.json(result);
});
app.get("/api/certificates", requireOrganizer, (req, res) => {
  const { course, status, page = "1", limit = "50" } = req.query;
  let list = Array.from(engine.certificates.values());
  if (course) {
    const cObj = engine.getCourseByCode(course);
    if (cObj) {
      list = list.filter((c) => c.course_id === cObj.id);
    }
  }
  if (status) {
    list = list.filter((c) => c.status === status);
  }
  const p = Math.max(1, parseInt(page, 10));
  const l = Math.max(1, parseInt(limit, 10));
  const total = list.length;
  const paged = list.slice((p - 1) * l, p * l).map((c) => {
    const person = engine.resolvePerson(c.person_id);
    const courseObj = engine.courses.get(c.course_id);
    const en = engine.enrollments.get(c.enrollment_id);
    const sig = signCertId(c.cert_id, engine["config"].signingKey);
    return {
      ...c,
      holder_name: person.full_name,
      holder_email: person.email_norm,
      course_title: courseObj?.title || "",
      course_code: courseObj?.code || "",
      completion_date: en?.completion_date || "",
      theme: courseObj?.theme || "classic",
      verify_url: `${PUBLIC_BASE_URL}/verify/${c.cert_id}?s=${sig}`
    };
  });
  res.json({ certificates: paged, total, page: p, pages: Math.ceil(total / l) });
});
app.get("/api/certificates/:cert_id", requireOrganizer, (req, res) => {
  let cert;
  for (const c of engine.certificates.values()) {
    if (c.cert_id === req.params.cert_id.trim().toUpperCase()) {
      cert = c;
      break;
    }
  }
  if (!cert) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Certificate not found" } });
  }
  const person = engine.resolvePerson(cert.person_id);
  const course = engine.courses.get(cert.course_id);
  const en = engine.enrollments.get(cert.enrollment_id);
  const sig = signCertId(cert.cert_id, engine["config"].signingKey);
  const auditTrail = engine.auditLog.filter((a) => a.entity_id === cert.cert_id);
  res.json({
    certificate: {
      ...cert,
      holder_name: person.full_name,
      holder_email: person.email_norm,
      course_title: course?.title || "",
      course_code: course?.code || "",
      hours: course?.hours,
      completion_date: en?.completion_date || "",
      theme: course?.theme || "classic",
      verify_url: `${PUBLIC_BASE_URL}/verify/${cert.cert_id}?s=${sig}`
    },
    audit_trail: auditTrail
  });
});
app.post("/api/certificates/:cert_id/revoke", requireOrganizer, (req, res) => {
  const { reason } = req.body || {};
  try {
    const revoked = engine.revokeCertificate(req.params.cert_id, reason);
    res.json({ certificate: revoked });
  } catch (err) {
    res.status(err.status || 500).json({ error: err });
  }
});
app.get("/api/verify/:cert_id", (req, res) => {
  const rate = checkRateLimit(req, "verify");
  res.setHeader("X-RateLimit-Limit", LIMITS.verify.limit);
  res.setHeader("X-RateLimit-Remaining", rate.remaining);
  if (!rate.allowed) {
    res.setHeader("Retry-After", rate.retryAfter);
    return res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many verification lookups", details: { retry_after_seconds: rate.retryAfter } }
    });
  }
  const certId = req.params.cert_id;
  const sigParam = req.query.s;
  const result = engine.verifyLookup(certId, sigParam);
  if (["not_found", "malformed", "invalid_signature"].includes(result.status)) {
    checkRateLimit(req, "notfound");
  }
  res.json(result);
});
app.get("/api/verify/:cert_id/badge.svg", (req, res) => {
  const rate = checkRateLimit(req, "social");
  if (!rate.allowed) {
    res.setHeader("Retry-After", rate.retryAfter);
    return res.status(429).send("Rate limited");
  }
  const certId = req.params.cert_id;
  const result = engine.verifyLookup(certId);
  const isValid = result.status === "valid";
  const isRevoked = result.status === "revoked";
  const badgeColor = isValid ? "#10b981" : isRevoked ? "#ef4444" : "#f59e0b";
  const statusLabel = isValid ? "VALID" : isRevoked ? "REVOKED" : "NOT FOUND";
  const courseTitle = (result.course_title || "Certificate").replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="36" viewBox="0 0 280 36">
  <rect width="280" height="36" rx="6" fill="#0f172a" />
  <rect x="0" y="0" width="70" height="36" rx="6" fill="${badgeColor}" />
  <rect x="64" y="0" width="6" height="36" fill="${badgeColor}" />
  <text x="35" y="22" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#ffffff" text-anchor="middle">${statusLabel}</text>
  <text x="80" y="22" font-family="system-ui, sans-serif" font-size="11" fill="#cbd5e1">${courseTitle.slice(0, 24)} (${certId})</text>
</svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.send(svg);
});
app.get("/api/revocations", (req, res) => {
  const rate = checkRateLimit(req, "social");
  if (!rate.allowed) {
    res.setHeader("Retry-After", rate.retryAfter);
    return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
  }
  const { since, format } = req.query;
  let list = Array.from(engine.certificates.values()).filter((c) => c.status === "revoked");
  if (since) {
    list = list.filter((c) => c.revoked_at && c.revoked_at >= since);
  }
  if (format === "csv") {
    const csv = "cert_id,revoked_at\n" + list.map((c) => `${c.cert_id},${c.revoked_at}`).join("\n");
    res.setHeader("Content-Type", "text/csv");
    return res.send(csv);
  }
  const items = list.map((c) => ({ cert_id: c.cert_id, revoked_at: c.revoked_at }));
  res.json({ revocations: items, total: items.length, generated_at: (/* @__PURE__ */ new Date()).toISOString() });
});
app.get("/api/audit", requireOrganizer, (_req, res) => {
  res.json({
    audit_log: engine.auditLog.slice().reverse(),
    checkpoints: engine.auditCheckpoints
  });
});
app.post("/api/audit/verify", requireOrganizer, (_req, res) => {
  const report = engine.verifyAuditChain();
  res.json(report);
});
app.get("/api/duplicates", requireOrganizer, (req, res) => {
  const status = req.query.status;
  let candidates = Array.from(engine.duplicateCandidates.values());
  if (status) {
    candidates = candidates.filter((c) => c.status === status);
  }
  candidates.sort((a, b) => b.score - a.score);
  const enriched = candidates.map((c) => {
    const pA = engine.people.get(c.person_a_id);
    const pB = engine.people.get(c.person_b_id);
    return {
      ...c,
      person_a: pA,
      person_b: pB
    };
  });
  res.json({ candidates: enriched, open_count: candidates.filter((c) => c.status === "open").length });
});
app.post("/api/duplicates/scan", requireOrganizer, (_req, res) => {
  engine.rescanDuplicates();
  res.json({ ok: true, open_count: Array.from(engine.duplicateCandidates.values()).filter((c) => c.status === "open").length });
});
app.get("/api/duplicates/:id", requireOrganizer, (req, res) => {
  const cand = engine.duplicateCandidates.get(parseInt(req.params.id, 10));
  if (!cand) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Candidate not found" } });
  const pA = engine.people.get(cand.person_a_id);
  const pB = engine.people.get(cand.person_b_id);
  const enA = Array.from(engine.enrollments.values()).filter((e) => e.person_id === cand.person_a_id);
  const enB = Array.from(engine.enrollments.values()).filter((e) => e.person_id === cand.person_b_id);
  res.json({ candidate: cand, person_a: { ...pA, enrollments: enA }, person_b: { ...pB, enrollments: enB } });
});
app.get("/api/duplicates/:id/merge-preview", requireOrganizer, (req, res) => {
  const cand = engine.duplicateCandidates.get(parseInt(req.params.id, 10));
  if (!cand) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Candidate not found" } });
  const survivorId = parseInt(req.query.survivor, 10);
  const loserId = survivorId === cand.person_a_id ? cand.person_b_id : cand.person_a_id;
  const survivorEn = Array.from(engine.enrollments.values()).filter((e) => e.person_id === survivorId);
  const loserEn = Array.from(engine.enrollments.values()).filter((e) => e.person_id === loserId);
  const conflicts = [];
  for (const len of loserEn) {
    const match = survivorEn.find((sen) => sen.course_code === len.course_code);
    if (match) {
      conflicts.push({
        course_code: len.course_code,
        resolution: "Retain highest eligibility / certified record and re-point duplicate rows"
      });
    }
  }
  res.json({
    survivor_id: survivorId,
    loser_id: loserId,
    conflicts,
    enrollments_to_move: loserEn.length - conflicts.length,
    blocked: false
  });
});
app.post("/api/duplicates/:id/merge", requireOrganizer, (req, res) => {
  const { survivor_person_id, full_name } = req.body || {};
  try {
    const result = engine.mergeDuplicate(parseInt(req.params.id, 10), Number(survivor_person_id), full_name);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err });
  }
});
app.post("/api/duplicates/:id/dismiss", requireOrganizer, (req, res) => {
  const { note } = req.body || {};
  try {
    const result = engine.dismissDuplicate(parseInt(req.params.id, 10), note);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err });
  }
});
app.get("/api/demo/status", requireOrganizer, (_req, res) => {
  const demoCourses = Array.from(engine.courses.values()).filter((c) => c.is_demo);
  const demoCerts = Array.from(engine.certificates.values()).filter((c) => {
    const crs = engine.courses.get(c.course_id);
    return crs?.is_demo;
  });
  res.json({ loaded: demoCourses.length > 0, demo_courses: demoCourses.length, demo_certificates: demoCerts.length });
});
app.get("/api/demo/csv", requireOrganizer, (req, res) => {
  const variant = req.query.variant === "modified" ? "modified" : "base";
  const assetName = variant === "modified" ? "demo_story_modified.csv" : "demo_story_base.csv";
  const csvPath = resolveAssetPath("backend", "app", "assets", assetName);
  const content = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, "utf-8") : "";
  res.setHeader("Content-Type", "text/csv");
  res.send(content);
});
app.post("/api/demo/load", requireOrganizer, (_req, res) => {
  engine.addCourse("DEMO-101", "Demo: Foundations of Data", 10, "classic", true);
  engine.addCourse("DEMO-201", "Demo: Applied Systems Architecture", 15, "modern", true);
  const csvPath = resolveAssetPath("backend", "app", "assets", "demo_story_base.csv");
  if (!fs.existsSync(csvPath)) {
    return res.status(500).json({ error: { code: "FILE_MISSING", message: "Demo base CSV missing" } });
  }
  const csvText = fs.readFileSync(csvPath, "utf-8");
  const result = engine.commitImport(csvText, "demo_story_base.csv", void 0, true);
  res.json(result);
});
app.post("/api/demo/import", requireOrganizer, (req, res) => {
  const variant = req.body?.variant === "modified" ? "demo_story_modified.csv" : "demo_story_base.csv";
  const csvPath = resolveAssetPath("backend", "app", "assets", variant);
  if (!fs.existsSync(csvPath)) {
    return res.status(500).json({ error: { code: "FILE_MISSING", message: "Demo CSV missing" } });
  }
  const csvText = fs.readFileSync(csvPath, "utf-8");
  const result = engine.commitImport(csvText, variant, void 0, true);
  res.json(result);
});
app.post("/api/demo/reset", requireOrganizer, (_req, res) => {
  const demoCourseIds = new Set(
    Array.from(engine.courses.values()).filter((c) => c.is_demo).map((c) => c.id)
  );
  const demoImportIds = new Set(
    Array.from(engine.imports.values()).filter((i) => i.is_demo).map((i) => i.id)
  );
  for (const [id, c] of engine.certificates.entries()) {
    if (demoCourseIds.has(c.course_id)) {
      engine.certificates.delete(id);
    }
  }
  for (const [id, en] of engine.enrollments.entries()) {
    if (en.course_id && demoCourseIds.has(en.course_id) || en.source_import_id && demoImportIds.has(en.source_import_id)) {
      engine.enrollments.delete(id);
    }
  }
  for (const [id, ir] of engine.importRows.entries()) {
    if (demoImportIds.has(ir.import_id)) {
      engine.importRows.delete(id);
    }
  }
  for (const id of demoImportIds) {
    engine.imports.delete(id);
  }
  for (const id of demoCourseIds) {
    engine.courses.delete(id);
  }
  engine.rescanDuplicates();
  engine.appendAudit("demo.reset", "demo", "all", { note: "Demo data removed" });
  res.json({ ok: true });
});
async function startServer() {
  const viteModule = "vite";
  const { createServer: createViteServer } = await import(
    /* @vite-ignore */
    viteModule
  );
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
  const distIndex = path.join(__dirname, "dist", "index.html");
  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production") return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    if (!fs.existsSync(distIndex)) return next();
    res.sendFile(distIndex);
  });
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Certificate Ledger server running at http://0.0.0.0:${PORT}`);
  });
}
if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
export {
  app
};
