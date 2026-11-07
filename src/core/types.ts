/** A row of any Sheet tab: column header → cell text. Columns are always addressed by header name. */
export type Row = Record<string, string>;

export type SessionKey = string; // "S1", "S2"

export interface CourseConfig {
  session: SessionKey;
  code: string;
  softMax: number;
  hardMax: number;
  /** Current limit used by the assignment algorithm: starts at softMax, may be raised up to hardMax. */
  limit: number;
  /** Prerequisite: minimum age on the session start date (null = no age rule). */
  minAge: number | null;
  /** Explicit "this course has no prerequisites" tick. */
  noPrereqs: boolean;
  /** Informational free text (e.g. "basic programming"). */
  prereqNote: string;
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
  notOkForCourses: 'NotOKForCourses',
  /** Provisional/final course assignment (filled by the phase 2 assignment algorithm). */
  assignedCourse: 'AssignedCourse',
  /** Assigned course at the moment the YOUNG flag was closed; a different assignment reopens the flag (phase 2). */
  youngApprovedWith: 'YoungApprovedWith',
  /** Why the algorithm assigned what it did (e.g. "2nd choice", "waitlist: …"). */
  assignNote: 'AssignNote',
  /** Manual course assignment from the waitlist; re-runs never move a pinned student. */
  pinnedCourse: 'PinnedCourse',
  /** "TRUE" = FULL student with a course place but no dorm place (on the "dorm full" list). */
  dormWaiting: 'DormWaiting',
  /** Accommodation after the user's decisions (e.g. FULL → EVENING when dorms are full). Empty = the form answer. */
  accommodationFinal: 'AccommodationFinal',
  locked: 'Locked',
  lockedAt: 'LockedAt',
  fee: 'Fee',
  aid: 'Aid',
  aidNote: 'AidNote',
  amountDue: 'AmountDue',
  admittedAt: 'AdmittedAt',
  paymentDeadline: 'PaymentDeadline',
  notes: 'Notes',
  withdrawnReason: 'WithdrawnReason',
} as const;

export type AppStatus = 'active' | 'merged' | 'withdrawn';
export type FLStatus = 'claimed' | 'confirmed' | 'rejected' | 'n.a.';

export const FLAG_TYPES = [
  'NO_COURSE_CHOSEN', 'UNKNOWN_COURSE', 'UNKNOWN_SESSION', 'BAD_BIRTH_DATE', 'YOUNG', 'TOO_OLD', 'SHORT_MOTIVATION',
  'NEAR_DUPLICATE',
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

/** Flags computed purely from the form contents (recomputed after edits). */
export const AUTO_FLAG_TYPES: FlagType[] = [
  'NO_COURSE_CHOSEN', 'UNKNOWN_COURSE', 'UNKNOWN_SESSION', 'BAD_BIRTH_DATE', 'YOUNG', 'TOO_OLD', 'SHORT_MOTIVATION',
];

export type FlagStatus = 'open' | 'approved' | 'overruled' | 'resolved';

export const FLAG_COLS = {
  flagId: 'FlagID',
  appId: 'AppID',
  type: 'Type',
  detail: 'Detail',
  status: 'Status',
  note: 'Note',
  /** Running log of actions taken / comments, one "yyyy-mm-dd user: text" line each. */
  comments: 'Comments',
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
