import type { DashboardStats, TenantTheme } from '@petcare/shared';

// Phase 1: single-tenant dev default. Later: derive from subdomain/login.
export const TENANT_SLUG = 'cedar-creek';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json() as Promise<T>;
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

export interface CalendarResponse {
  capacity: { boarding: number; daycare: number };
  days: CalendarDay[];
  bookings: BookingRow[];
}

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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ staffName: 'Front desk', ...checklist }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Check-in failed (${res.status})`);
  }
}

export async function checkOut(bookingId: string): Promise<void> {
  const res = await fetch(`/api/${TENANT_SLUG}/bookings/${bookingId}/check-out`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ staffName: 'Front desk' }),
  });
  if (!res.ok) throw new Error(`Check-out failed: ${res.status}`);
}
