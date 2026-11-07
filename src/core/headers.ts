import { collapseWs } from './text';
import type { FieldKey } from './types';

/** Header comparison key: whitespace collapsed (handles the double space / trailing space in the 2026 headers). */
export function normHeader(h: string): string {
  return collapseWs(h.replace(/^﻿/, ''));
}

/** Non-data columns of the application form export; ignored on import (still kept in RawImports). */
export const DECORATIVE_HEADERS_2026 = [
  'Please carefully read the information at the top of this page before completing your application.',
  'Student Information',
  'Parent Information',
  'more_info_activities',
  'Course Enrollment',
  'Course page link',
  'Fees',
  'Academic info',
  'Other',
].map(normHeader);

/** Column map for the 2026 export (whitespace-normalised header text). */
export const COLUMN_MAP_2026: Record<FieldKey, string> = Object.fromEntries(
  Object.entries({
    firstName: 'Student first name',
    surname: 'Student surname',
    address: 'Student full address',
    phone: 'Student phone number',
    email: 'Student e-mail address',
    birthDate: 'Student birth date',
    nationality: 'Student nationality/ies',
    language: 'Student primary language(s) (i.e. mother tongue)',
    gender: 'Student gender',
    food: 'Student: Food allergies or dietary restrictions (e.g. vegan, halal, celiac, ...)?',
    medical: 'Student: Any medical conditions that we should be aware of?',
    tshirt: 'Student T-shirt size',
    parentName: 'Parent full name',
    parentPhone: 'Parent telephone number',
    parentEmail: 'Parent e-mail address',
    parentAllMails: 'Please send all organizational e-mails ALSO to this parent e-mail address',
    parentAuthData: 'Parent authorization for data collection',
    parentAuthFreeTime: 'Parent authorization for free time',
    heardOf: 'How did you hear of this summer school?',
    session: 'Which Session are you applying to?',
    s1c1: 'Session I: First choice of course',
    s1c2: 'Session I: Second choice of course',
    s1c3: 'Session I: Third choice of course',
    s2c1: 'Session II: First choice of course',
    s2c2: 'Session II: Second choice of course',
    s2c3: 'Session II: Third choice of course',
    laptop: 'I am able to bring a personal laptop to the summer school if necessary for my course',
    accommodation: 'Accommodation choice:',
    fallback: 'If you have chosen to participate with accommodation, but all accommodations are full, then:',
    specialRequests:
      'If you have chosen to participate as a FULL student, are there any special requests you would like to make (e.g. in the same hall as friend(s))?',
    status: 'I am a',
    grade: 'Grade/year ("studiejaar") in current 2025-2026 academic year',
    yearsLeft: 'In July 2026, how many full academic years are left until you graduate high school?',
    school: 'What school are you attending (name, city, and country if not Belgium)?',
    major:
      'Study major or direction ("studierichting") in current 2025-2026 academic year (indicate if will be different next academic year)',
    motivation: 'Student motivation statement, ca. 250-500 words',
    previous: 'If you participated in (a) previous Summer of Science edition(s), please indicate the course(s) you took',
    remarks: 'Any other remarks?',
    photo: 'Photo permission',
    dataProtection: 'Data protection',
    posting: 'Posting Date/Time',
  }).map(([k, v]) => [k, normHeader(v)]),
) as Record<FieldKey, string>;

/** Key that ignores years and digits, so "2025-2026" headers still match "2026-2027" ones. */
function looseHeaderKey(h: string): string {
  return normHeader(h).toLowerCase().replace(/\d+/g, '#');
}

export interface MappingCheck {
  /** Field → CSV header that matched exactly. */
  matched: Partial<Record<FieldKey, string>>;
  /** Field → CSV header that matches apart from digits (year text). Needs the user's OK. */
  suggested: Partial<Record<FieldKey, string>>;
  /** Fields with no matching CSV header at all. */
  missing: FieldKey[];
  /** CSV headers that are neither mapped nor known decorative columns. */
  unknown: string[];
}

export function checkMapping(map: Record<FieldKey, string>, csvHeaders: string[]): MappingCheck {
  const csv = csvHeaders.map(normHeader);
  const used = new Set<string>();
  const res: MappingCheck = { matched: {}, suggested: {}, missing: [], unknown: [] };
  for (const [field, header] of Object.entries(map) as [FieldKey, string][]) {
    const exact = csv.find((h) => h === normHeader(header));
    if (exact) {
      res.matched[field] = exact;
      used.add(exact);
      continue;
    }
    const loose = csv.find((h) => !used.has(h) && looseHeaderKey(h) === looseHeaderKey(header));
    if (loose) {
      res.suggested[field] = loose;
      used.add(loose);
    } else res.missing.push(field);
  }
  res.unknown = csv.filter((h) => !used.has(h) && !DECORATIVE_HEADERS_2026.includes(h));
  return res;
}
