/** A row of any Sheet tab: column header → cell text. Columns are always addressed by header name. */
export type Row = Record<string, string>;

export type SessionKey = string; // "S1", "S2"

export interface CourseConfig {
  session: SessionKey;
  code: string;
  softMax: number;
  hardMax: number;
}

export interface SessionConfig {
  key: SessionKey;
  /** Exactly as the form shows it, e.g. "Session I (20-24 July 2026)". */
  label: string;
  /** yyyy-mm-dd */
  startDate: string;
  dormCapacity: number;
}

export type Accommodation = 'FULL' | 'EVENING' | 'DAY';

export interface SeasonConfig {
  season: string;
  idPrefix: string;
  sessions: SessionConfig[];
  courses: CourseConfig[];
  fees: Record<Accommodation, { FL: number; other: number }>;
  thresholds: {
    /** Age (on session start) at or below which a student is "young". */
    youngMaxAge: number;
    /** "Years left" answer that makes a student "young". */
    youngYearsLeft: string;
    /** Age (on session start) at or above which a student is "too old". */
    oldMinAge: number;
    /** Motivations with fewer words than this are flagged. */
    minMotivationWords: number;
  };
  paymentDeadlineDays: number;
  /** Internal field key → CSV header text (whitespace-normalised). */
  columnMap: Record<FieldKey, string>;
  /** Text of the "I am a" answer that claims Flemish status. */
  flemishStatusValue: string;
}

/** Form fields the app knows about. The column map ties each to the current season's header text. */
export const FIELD_KEYS = [
  'firstName', 'surname', 'address', 'phone', 'email', 'birthDate', 'nationality', 'language', 'gender',
  'food', 'medical', 'tshirt', 'parentName', 'parentPhone', 'parentEmail', 'parentAllMails',
  'parentAuthData', 'parentAuthFreeTime', 'heardOf', 'session',
  's1c1', 's1c2', 's1c3', 's2c1', 's2c2', 's2c3',
  'laptop', 'accommodation', 'fallback', 'specialRequests', 'status', 'grade', 'yearsLeft', 'school',
  'major', 'motivation', 'previous', 'remarks', 'photo', 'dataProtection', 'posting',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** App-managed columns of the Applications tab (form columns follow, under their header text). */
export const APP_COLS = {
  id: 'ID',
  importKey: 'ImportKey',
  personKey: 'PersonKey',
  postingUTC: 'PostingUTC',
  status: 'Status',
  mergedInto: 'MergedInto',
  session: 'Session',
  choice1: 'Choice1',
  choice2: 'Choice2',
  choice3: 'Choice3',
  flStatus: 'FLStatus',
  openFlags: 'OpenFlags',
  emailSentCourse: 'EmailSentCourse',
  courseOK: 'CourseOK',
  emailSentStudent: 'EmailSentStudent',
  dormOK: 'DormOK',
  okForCourses: 'OKForCourses',
  notes: 'Notes',
  withdrawnReason: 'WithdrawnReason',
} as const;

export type AppStatus = 'active' | 'merged' | 'withdrawn';
export type FLStatus = 'claimed' | 'confirmed' | 'rejected' | 'n.a.';

export const FLAG_TYPES = [
  'OTHER_SESSION_COURSE', 'NO_FIRST_CHOICE', 'DUPLICATE_CHOICE', 'CHOICE_GAP', 'UNKNOWN_COURSE',
  'UNKNOWN_SESSION', 'BAD_BIRTH_DATE', 'YOUNG', 'TOO_OLD', 'SHORT_MOTIVATION', 'NEAR_DUPLICATE',
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

/** Flags computed purely from the form contents (recomputed after edits). */
export const AUTO_FLAG_TYPES: FlagType[] = [
  'OTHER_SESSION_COURSE', 'NO_FIRST_CHOICE', 'DUPLICATE_CHOICE', 'CHOICE_GAP', 'UNKNOWN_COURSE',
  'UNKNOWN_SESSION', 'BAD_BIRTH_DATE', 'YOUNG', 'TOO_OLD', 'SHORT_MOTIVATION',
];

export type FlagStatus = 'open' | 'approved' | 'overruled' | 'resolved';

export const FLAG_COLS = {
  flagId: 'FlagID',
  appId: 'AppID',
  type: 'Type',
  detail: 'Detail',
  status: 'Status',
  note: 'Note',
  createdAt: 'CreatedAt',
  resolvedBy: 'ResolvedBy',
  resolvedAt: 'ResolvedAt',
} as const;

export const AUDIT_COLS = ['Timestamp', 'User', 'AppID', 'Field', 'OldValue', 'NewValue', 'Action'] as const;

export const RAW_META_COLS = ['ImportedAt', 'RowNo', 'ImportKey', 'AppID', 'DuplicateOf'] as const;

export interface NewFlag {
  type: FlagType;
  detail: string;
}

export interface AuditEntry {
  Timestamp: string;
  User: string;
  AppID: string;
  Field: string;
  OldValue: string;
  NewValue: string;
  Action: string;
}
