import { choiceFields } from './config';
import type { FieldKey, SeasonConfig } from './types';

const CHECKBOX = ['TRUE', ''];

/** Fixed answers of the 2026 form (the form is expected to stay the same; season-specific ones come from the config). */
const FIXED_2026: Partial<Record<FieldKey, string[]>> = {
  gender: ['M', 'W', 'X'],
  tshirt: ['XS', 'S', 'M', 'L', 'XL'],
  yearsLeft: ['0', '1', '2', '>2'],
  accommodation: ['FULL', 'EVENING', 'DAY'],
  fallback: [
    '', // left empty in some exports
    'Not applicable',
    'I DO NOT wish to participate in the summer school',
    'I DO still wish to participate in the summer school, as an EVENING student.',
    'I DO still wish to participate in the summer school, as a DAY student.',
  ],
  laptop: ['Yes', 'No'],
  photo: ['Yes', 'No'],
  parentAllMails: CHECKBOX,
  parentAuthData: CHECKBOX,
  parentAuthFreeTime: CHECKBOX,
  dataProtection: CHECKBOX,
};

/** "Session I (20-24 July 2026)" → "Session I" */
export function sessionShortName(label: string): string {
  return label.replace(/\s*\(.*$/, '').trim();
}

/**
 * Allowed values for a form field, or null for free text. Editing such a field is dropdown-only.
 * Course columns allow empty, "(Not applying to Session X)" and that session's course codes.
 */
export function fieldOptions(key: FieldKey, cfg: SeasonConfig): string[] | null {
  if (key === 'session') return cfg.sessions.map((s) => s.label);
  if (key === 'status')
    return [cfg.flemishStatusValue, 'Student at a Belgian International school', 'International student from abroad'];
  for (const [sKey, fields] of Object.entries(choiceFields(cfg))) {
    if ((fields as readonly string[]).includes(key)) {
      const s = cfg.sessions.find((x) => x.key === sKey)!;
      return ['', `(Not applying to ${sessionShortName(s.label)})`, ...cfg.courses.filter((c) => c.session === sKey).map((c) => c.code)];
    }
  }
  return FIXED_2026[key] ?? null;
}
