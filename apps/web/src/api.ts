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
}

export const fetchPet = (petId: string) => get<PetProfile>(`/api/${TENANT_SLUG}/pets/${petId}`);

export async function checkIn(bookingId: string): Promise<void> {
  const res = await fetch(`/api/${TENANT_SLUG}/bookings/${bookingId}/check-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ staffName: 'Front desk' }),
  });
  if (!res.ok) throw new Error(`Check-in failed: ${res.status}`);
}

export async function checkOut(bookingId: string): Promise<void> {
  const res = await fetch(`/api/${TENANT_SLUG}/bookings/${bookingId}/check-out`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ staffName: 'Front desk' }),
  });
  if (!res.ok) throw new Error(`Check-out failed: ${res.status}`);
}
