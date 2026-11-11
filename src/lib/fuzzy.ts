/**
 * Fuzzy matching, blocking, and candidate scoring for near-duplicate identities.
 */

// Known email domain typos
export const STATIC_DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'exmaple.test': 'example.test',
  'exampel.test': 'example.test',
  'exmaple.com': 'example.com',
};

// Common nickname equivalences (symmetric)
export const NICKNAME_GROUPS: string[][] = [
  ['jon', 'john', 'jonathan'],
  ['bill', 'will', 'william', 'billy', 'liam'],
  ['bob', 'rob', 'robert', 'bobby', 'robbie'],
  ['liz', 'beth', 'betty', 'elizabeth', 'eliza'],
  ['mike', 'michael', 'mikey'],
  ['kate', 'katie', 'katherine', 'catherine', 'kathryn'],
  ['dave', 'david', 'davey'],
  ['tom', 'thomas', 'tommy'],
  ['jim', 'james', 'jimmy'],
  ['steve', 'steven', 'stephen'],
  ['chris', 'christopher'],
  ['dan', 'daniel', 'danny'],
  ['alex', 'alexander', 'alexandra'],
  ['matt', 'matthew'],
  ['sam', 'samuel', 'samantha'],
  ['ben', 'benjamin', 'benny'],
  ['andy', 'andrew', 'drew'],
  ['nick', 'nicholas'],
  ['joe', 'joseph', 'joey'],
  ['greg', 'gregory'],
  ['tony', 'anthony'],
  ['ed', 'edward', 'eddie'],
];

const NICKNAME_MAP = new Map<string, Set<string>>();
for (const group of NICKNAME_GROUPS) {
  const normGroup = group.map((n) => n.toLowerCase().trim());
  for (const name of normGroup) {
    if (!NICKNAME_MAP.has(name)) {
      NICKNAME_MAP.set(name, new Set());
    }
    for (const other of normGroup) {
      if (other !== name) {
        NICKNAME_MAP.get(name)!.add(other);
      }
    }
  }
}

export function areNicknames(nameA: string, nameB: string): boolean {
  const a = nameA.toLowerCase().trim();
  const b = nameB.toLowerCase().trim();
  if (a === b) return true;
  return NICKNAME_MAP.get(a)?.has(b) ?? false;
}

/**
 * Calculates Damerau-Levenshtein distance (insertions, deletions, substitutions, transpositions)
 */
export function damerauLevenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;

  const matrix: number[][] = [];
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
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );

      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[al][bl];
}

/**
 * Normalizes full name: strip punctuation, collapse whitespace, lowercase.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses full name into tokens: first name, last name.
 */
export function splitName(name: string): { first: string; last: string } {
  const norm = normalizeName(name);
  const parts = norm.split(' ');
  if (parts.length === 1) {
    return { first: parts[0], last: '' };
  }
  return {
    first: parts[0],
    last: parts[parts.length - 1],
  };
}

/**
 * Clean email local part (strip dots and tags like +test)
 */
export function cleanLocalPart(local: string): string {
  return local.replace(/\./g, '').split('+')[0];
}

export interface PersonCandidateInput {
  id: number;
  fullName: string;
  emailNorm: string;
  enrollments?: Array<{ courseCode: string; completionDate?: string | null }>;
}

export interface CandidateResult {
  personAId: number;
  personBId: number;
  score: number;
  reasons: string[];
}

/**
 * Scores a pair of people for near-duplicate likelihood.
 */
export function scorePair(
  a: PersonCandidateInput,
  b: PersonCandidateInput,
  frequentDomains?: Map<string, number>
): { score: number; reasons: string[] } {
  const normNameA = normalizeName(a.fullName);
  const normNameB = normalizeName(b.fullName);

  const [localA, domainA = ''] = a.emailNorm.split('@');
  const [localB, domainB = ''] = b.emailNorm.split('@');

  let nameScore = 0;
  let nameReason = '';

  const { first: firstA, last: lastA } = splitName(normNameA);
  const { first: firstB, last: lastB } = splitName(normNameB);

  if (normNameA === normNameB && normNameA.length > 0) {
    nameScore = 0.45;
    nameReason = 'Exact normalized name match';
  } else if (lastA && lastB && lastA === lastB && areNicknames(firstA, firstB)) {
    nameScore = 0.40;
    nameReason = `Nickname match: ${firstA} ≈ ${firstB}`;
  } else {
    const dist = damerauLevenshtein(normNameA, normNameB);
    if (dist <= 1 && normNameA.length > 3) {
      nameScore = 0.35;
      nameReason = 'Close name spelling (distance ≤ 1)';
    }
  }

  let emailScore = 0;
  let emailReason = '';

  const cleanA = cleanLocalPart(localA);
  const cleanB = cleanLocalPart(localB);

  // Check domain typo
  const isTypoA = STATIC_DOMAIN_TYPOS[domainA] === domainB || STATIC_DOMAIN_TYPOS[domainB] === domainA;
  let isDynamicDomainTypo = false;
  if (!isTypoA && domainA !== domainB && frequentDomains) {
    const freqA = frequentDomains.get(domainA) || 0;
    const freqB = frequentDomains.get(domainB) || 0;
    if (freqA >= 3 && damerauLevenshtein(domainA, domainB) === 1) isDynamicDomainTypo = true;
    if (freqB >= 3 && damerauLevenshtein(domainA, domainB) === 1) isDynamicDomainTypo = true;
  }

  if (cleanA === cleanB && (isTypoA || isDynamicDomainTypo)) {
    emailScore = 0.50;
    const targetDomain = isTypoA ? (STATIC_DOMAIN_TYPOS[domainA] || STATIC_DOMAIN_TYPOS[domainB]) : (domainA.length > domainB.length ? domainA : domainB);
    emailReason = `Email domain looks like a typo of ${targetDomain}`;
  } else {
    const fullEmailDist = damerauLevenshtein(a.emailNorm, b.emailNorm);
    if (fullEmailDist <= 2) {
      emailScore = 0.40;
      emailReason = `Email addresses differ by only ${fullEmailDist} character(s)`;
    } else if (cleanA === cleanB && cleanA.length > 2) {
      if (domainA === domainB) {
        emailScore = 0.30;
        emailReason = 'Identical email local part with formatting/tag difference';
      } else {
        emailScore = 0.25;
        emailReason = 'Same email username on different domain';
      }
    }
  }

  let overlapBonus = 0;
  let overlapReason = '';
  if (a.enrollments && b.enrollments) {
    for (const enA of a.enrollments) {
      for (const enB of b.enrollments) {
        if (enA.courseCode === enB.courseCode && enA.completionDate && enA.completionDate === enB.completionDate) {
          overlapBonus = 0.10;
          overlapReason = `Shared completion in course ${enA.courseCode} on ${enA.completionDate}`;
          break;
        }
      }
      if (overlapBonus > 0) break;
    }
  }

  const reasons: string[] = [];
  if (nameReason) reasons.push(nameReason);
  if (emailReason) reasons.push(emailReason);
  if (overlapReason) reasons.push(overlapReason);

  // Requirement: at score >= 0.70 and with at least one email signal AND one name signal
  if (nameScore === 0 || emailScore === 0) {
    return { score: 0, reasons: [] };
  }

  const totalScore = Math.min(1.0, +(nameScore + emailScore + overlapBonus).toFixed(3));
  return { score: totalScore, reasons };
}

/**
 * Scans a list of active people using blocking to avoid O(n^2).
 */
export function scanDuplicates(
  people: PersonCandidateInput[],
  frequentDomains?: Map<string, number>
): CandidateResult[] {
  // Compute frequent domains if not provided
  const domainCounts = frequentDomains || new Map<string, number>();
  if (!frequentDomains) {
    for (const p of people) {
      const parts = p.emailNorm.split('@');
      if (parts[1]) {
        domainCounts.set(parts[1], (domainCounts.get(parts[1]) || 0) + 1);
      }
    }
  }

  // Blocking keys:
  // (a) last name token + first letter of first name
  // (b) clean email local part first 4 chars
  // (c) canonical typo corrected domain
  const blocks = new Map<string, number[]>();

  function addToBlock(key: string, personIndex: number) {
    if (!key) return;
    if (!blocks.has(key)) {
      blocks.set(key, []);
    }
    const list = blocks.get(key)!;
    if (list.length < 200 && !list.includes(personIndex)) {
      list.push(personIndex);
    }
  }

  people.forEach((p, idx) => {
    const { first, last } = splitName(p.fullName);
    if (last) {
      addToBlock(`nl:${last}:${first.charAt(0)}`, idx);
    }
    const [local, domain = ''] = p.emailNorm.split('@');
    const cleanLocal = cleanLocalPart(local);
    if (cleanLocal.length >= 4) {
      addToBlock(`el:${cleanLocal.slice(0, 4)}`, idx);
    }
    const canonicalDomain = STATIC_DOMAIN_TYPOS[domain] || domain;
    addToBlock(`dm:${cleanLocal}:${canonicalDomain}`, idx);
  });

  const checkedPairs = new Set<string>();
  const candidates: CandidateResult[] = [];

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
        if (score >= 0.70) {
          candidates.push({
            personAId: minId,
            personBId: maxId,
            score,
            reasons,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
