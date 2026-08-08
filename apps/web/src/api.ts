import type { CareSlot, CareTask, DashboardStats, TenantTheme } from '@petcare/shared';

// Phase 1: single-tenant dev default. Later: derive from subdomain/login.
export const TENANT_SLUG = 'cedar-creek';

/** Raised when the staff session is missing or expired, so the app can re-gate. */
export class StaffAuthError extends Error {
  constructor() {
    super('Sign in to continue');
    this.name = 'StaffAuthError';
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (res.status === 401) throw new StaffAuthError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json() as Promise<T>;
}

export interface StaffUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: 'owner' | 'manager' | 'kennel_tech' | 'front_desk';
}

export const ROLE_LABEL: Record<StaffUser['role'], string> = {
  owner: 'Owner',
  manager: 'Manager',
  kennel_tech: 'Kennel tech',
  front_desk: 'Front desk',
};

export const fetchStaffMe = () => get<{ staff: StaffUser }>(`/api/${TENANT_SLUG}/staff/me`);

export async function staffLogin(email: string, password: string): Promise<StaffUser> {
  const res = await fetch(`/api/${TENANT_SLUG}/staff/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Could not sign in');
  }
  return ((await res.json()) as { staff: StaffUser }).staff;
}

export async function staffLogout(): Promise<void> {
  await fetch(`/api/${TENANT_SLUG}/staff/logout`, { method: 'POST', credentials: 'include' });
}

export interface TenantMeta {
  slug: string;
  name: string;
  plan: 'free' | 'pro';
  theme: TenantTheme;
}

export interface BoardOccupant {
  bookingId: string;
  serviceType: 'boarding' | 'daycare';
  status: string;
  startDate: string;
  endDate: string;
  petId: string;
  petName: string;
  breed: string | null;
  avatarColor: string;
  hasMeds: boolean;
  isNewClient: boolean;
  nightNumber: number | null;
  totalNights: number | null;
}

export interface BoardCell {
  run: { id: string; code: string; zone: string; kind: string; capacity: number };
  occupants: BoardOccupant[];
}

export interface BookingRow {
  id: string;
  serviceType: 'boarding' | 'daycare';
  status: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  petName: string;
  breed: string | null;
  avatarColor: string;
  clientName: string;
  runCode: string | null;
}

export interface ClientRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  smsOptIn: boolean;
  balanceCents: number;
  createdAt: string;
  pets: Array<{ id: string; name: string; breed: string | null; avatarColor: string }>;
}

export const fetchTenantMeta = () => get<TenantMeta>(`/api/tenants/${TENANT_SLUG}/meta`);
export const fetchDashboard = () => get<DashboardStats>(`/api/${TENANT_SLUG}/dashboard`);
export const fetchBoard = () => get<{ cells: BoardCell[] }>(`/api/${TENANT_SLUG}/board`);
export const fetchBookings = (from: string, to: string) =>
  get<{ bookings: BookingRow[] }>(`/api/${TENANT_SLUG}/bookings?from=${from}&to=${to}`);
export const fetchClients = () => get<{ clients: ClientRow[] }>(`/api/${TENANT_SLUG}/clients`);

export interface CalendarDay {
  date: string;
  boarding: number;
  daycare: number;
  pending: number;
}

export interface PlayGroup {
  id: string;
  code: string;
  label: string;
  capacity: number;
}

export interface CalendarBooking extends BookingRow {
  petId: string;
  hasMeds: boolean;
  runLabel: string | null;
}

export interface CalendarResponse {
  capacity: { boarding: number; daycare: number };
  days: CalendarDay[];
  groups: PlayGroup[];
  bookings: CalendarBooking[];
}

export interface PlayGroupSetting extends PlayGroup {
  displayOrder: number;
  active: boolean;
  bookedToday: number;
}

export const fetchPlayGroups = () =>
  get<{ groups: PlayGroupSetting[] }>(`/api/${TENANT_SLUG}/settings/play-groups`);

async function send<T>(path: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${TENANT_SLUG}${path}`, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(parsed?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const createPlayGroup = (body: { label: string; capacity: number }) =>
  send<{ id: string; code: string }>('/settings/play-groups', 'POST', body);

export const updatePlayGroup = (
  groupId: string,
  body: { label?: string; capacity?: number; active?: boolean },
) => send<PlayGroupSetting>(`/settings/play-groups/${groupId}`, 'PATCH', body);

export const fetchCalendar = (from: string, to: string) =>
  get<CalendarResponse>(`/api/${TENANT_SLUG}/calendar?from=${from}&to=${to}`);

export interface PetProfile {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: 'M' | 'F' | null;
  birthdate: string | null;
  weightLbs: number | null;
  avatarColor: string;
  feedingNotes: string | null;
  medicationNotes: string | null;
  allergyNotes: string | null;
  owner: {
    id: string;
    name: string;
    phone: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    balanceCents: number;
  };
  vaccinations: Array<{ id: string; vaccine: string; expiresOn: string; verified: boolean }>;
  currentStay: {
    bookingId: string;
    serviceType: 'boarding' | 'daycare';
    status: string;
    startDate: string;
    endDate: string;
    runCode: string | null;
    intake: {
      belongings: string | null;
      collarType: string | null;
      foodSource: 'owner' | 'house' | null;
      foodDescription: string | null;
      feedingAmount: string | null;
      feedingTimes: string[];
      bowlType: string | null;
      treatsAllowed: boolean;
      treatsNotes: string | null;
      bonesAllowed: boolean;
      bonesNotes: string | null;
      recordedBy: string | null;
      recordedAt: string;
    } | null;
    medications: Array<{
      id: string;
      name: string;
      dose: string | null;
      schedule: string;
      withFood: boolean;
      notes: string | null;
    }>;
  } | null;
}

export const fetchPet = (petId: string) => get<PetProfile>(`/api/${TENANT_SLUG}/pets/${petId}`);

export interface CareTasksResponse {
  date: string;
  tasks: CareTask[];
  summary: { total: number; done: number; medicationOutstanding: number };
}

export const fetchCareTasks = (date: string) =>
  get<CareTasksResponse>(`/api/${TENANT_SLUG}/care-tasks?date=${date}`);

export interface CareLogReport {
  date: string;
  summary: {
    pets: number;
    feedingsScheduled: number;
    feedingsGiven: number;
    medicationsScheduled: number;
    medicationsGiven: number;
  };
  pets: Array<{ petId: string; petName: string; runCode: string | null; tasks: CareTask[] }>;
}

export const fetchCareLog = (date: string) =>
  get<CareLogReport>(`/api/${TENANT_SLUG}/reports/care-log?date=${date}`);

interface CareTaskKey {
  bookingId: string;
  type: 'feeding' | 'medication';
  slot: CareSlot;
  subject?: string | null;
  date: string;
}

export async function completeCareTask(key: CareTaskKey, note?: string): Promise<void> {
  const res = await fetch(`/api/${TENANT_SLUG}/care-tasks`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...key, note }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not log that round (${res.status})`);
  }
}

export async function undoCareTask(key: CareTaskKey): Promise<void> {
  const res = await fetch(`/api/${TENANT_SLUG}/care-tasks`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(key),
  });
  if (!res.ok) throw new Error(`Could not undo that round (${res.status})`);
}

export interface VaccineAlert {
  id: string;
  vaccine: string;
  expiresOn: string;
  daysLeft: number;
  expired: boolean;
  verified: boolean;
  petId: string;
  petName: string;
  avatarColor: string;
  clientName: string;
  clientPhone: string | null;
  stay: {
    bookingId: string;
    startDate: string;
    endDate: string;
    status: string;
    runCode: string | null;
  } | null;
  expiresDuringStay: boolean;
}

export interface VaccineAlertsResponse {
  withinDays: number;
  alerts: VaccineAlert[];
  summary: { total: number; expired: number; duringStay: number };
}

export const fetchVaccineAlerts = (withinDays = 30) =>
  get<VaccineAlertsResponse>(`/api/${TENANT_SLUG}/alerts/vaccines?withinDays=${withinDays}`);

export interface PetOption {
  id: string;
  name: string;
  breed: string | null;
  avatarColor: string;
  clientName: string;
}

export interface RunOption {
  id: string;
  code: string;
  zone: string;
  kind: string;
  capacity: number;
  available: boolean;
  takenBy: string | null;
  remaining: number;
}

export const fetchPets = () => get<{ pets: PetOption[] }>(`/api/${TENANT_SLUG}/pets`);

export const fetchRuns = (from: string, to: string, serviceType: 'boarding' | 'daycare') =>
  get<{ runs: RunOption[] }>(
    `/api/${TENANT_SLUG}/runs?from=${from}&to=${to}&serviceType=${serviceType}`,
  );

export interface NewBooking {
  petId: string;
  serviceType: 'boarding' | 'daycare';
  startDate: string;
  endDate: string;
  runId?: string;
  notes?: string;
}

/** Throws with the server's message so the form can show conflicts verbatim. */
export async function createBooking(booking: NewBooking): Promise<{ id: string }> {
  const res = await fetch(`/api/${TENANT_SLUG}/bookings`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(booking),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not save the booking (${res.status})`);
  }
  return res.json() as Promise<{ id: string }>;
}

export interface StayMedication {
  name: string;
  dose?: string;
  schedule?: string;
  withFood?: boolean;
  notes?: string;
}

export interface StayIntake {
  belongings?: string;
  collarType?: string;
  foodSource?: 'owner' | 'house';
  foodDescription?: string;
  feedingAmount?: string;
  feedingTimes?: string[];
  bowlType?: string;
  treatsAllowed?: boolean;
  treatsNotes?: string;
  bonesAllowed?: boolean;
  bonesNotes?: string;
  medications?: StayMedication[];
}

export interface CheckInChecklist {
  feedingConfirmed?: boolean;
  medsConfirmed?: boolean;
  vaccinesVerified?: boolean;
  signatureCaptured?: boolean;
  intake?: StayIntake;
}

export async function checkIn(
  bookingId: string,
  checklist: CheckInChecklist = {},
): Promise<void> {
  const res = await fetch(`/api/${TENANT_SLUG}/bookings/${bookingId}/check-in`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(checklist),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Check-in failed (${res.status})`);
  }
}

export async function checkOut(bookingId: string): Promise<void> {
  const res = await fetch(`/api/${TENANT_SLUG}/bookings/${bookingId}/check-out`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Check-out failed: ${res.status}`);
}
