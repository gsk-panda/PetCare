import { TENANT_SLUG } from '../api';

const base = `/api/${TENANT_SLUG}/portal`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Something went wrong (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export class AuthError extends Error {
  constructor() {
    super('Please sign in');
    this.name = 'AuthError';
  }
}

export interface PortalClient {
  id: string;
  firstName: string;
  lastName: string;
  contactEmail: string | null;
  phone: string | null;
  smsOptIn: boolean;
  smsConsentAt: string | null;
  smsRevokedAt: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  balanceCents: number;
}

export interface PortalPet {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: 'M' | 'F' | null;
  birthdate: string | null;
  weightLbs: number | null;
  avatarColor: string;
  photoUrl: string | null;
  feedingNotes: string | null;
  medicationNotes: string | null;
  allergyNotes: string | null;
  vaccinations: Array<{ id: string; vaccine: string; expiresOn: string; verified: boolean }>;
}

export interface PortalBooking {
  id: string;
  serviceType: 'boarding' | 'daycare';
  status: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  source: string;
  canceledAt: string | null;
  cancelReason: string | null;
  petId: string;
  petName: string;
  avatarColor: string;
  photoUrl: string | null;
  runCode: string | null;
  runLabel: string | null;
}

export interface PortalAlert {
  id: string;
  vaccine: string;
  expiresOn: string;
  daysLeft: number;
  expired: boolean;
  verified: boolean;
  petId: string;
  petName: string;
  affectsStay: boolean;
  stayStart: string | null;
  stayEnd: string | null;
}

export interface StayLog {
  stay: {
    id: string;
    serviceType: string;
    status: string;
    startDate: string;
    endDate: string;
    petName: string;
    runCode: string | null;
    runLabel: string | null;
  };
  events: Array<{
    type: string;
    slot: string | null;
    subject: string | null;
    occurredAt: string;
    careDate: string | null;
    note: string | null;
  }>;
  intake: {
    belongings: string | null;
    collarType: string | null;
    foodSource: string | null;
    foodDescription: string | null;
    feedingAmount: string | null;
    feedingTimes: string[];
    bowlType: string | null;
    treatsAllowed: boolean;
    bonesAllowed: boolean;
  } | null;
  medications: Array<{ name: string; dose: string | null; schedule: string; withFood: boolean }>;
}

export const requestCode = (email: string) =>
  call<{ sent: boolean; devCode?: string }>('/login/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const verifyCode = (email: string, code: string) =>
  call<{ ok: boolean }>('/login/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });

export const logout = () => call<{ ok: boolean }>('/logout', { method: 'POST' });

export const fetchMe = () => call<{ email: string; client: PortalClient }>('/me');

export const updateMe = (body: Partial<PortalClient> & { smsOptIn?: boolean }) =>
  call<{ ok: boolean }>('/me', { method: 'PATCH', body: JSON.stringify(body) });

export const fetchPets = () => call<{ pets: PortalPet[] }>('/pets');

export const updatePet = (
  petId: string,
  body: {
    feedingNotes?: string;
    medicationNotes?: string;
    allergyNotes?: string;
    weightLbs?: number | null;
    photoUrl?: string | null;
  },
) => call<{ ok: boolean }>(`/pets/${petId}`, { method: 'PATCH', body: JSON.stringify(body) });

export const addVaccination = (petId: string, vaccine: string, expiresOn: string) =>
  call<{ id: string }>(`/pets/${petId}/vaccinations`, {
    method: 'POST',
    body: JSON.stringify({ vaccine, expiresOn }),
  });

export const fetchBookings = () => call<{ bookings: PortalBooking[] }>('/bookings');

export const createBooking = (body: {
  petId: string;
  serviceType: 'boarding' | 'daycare';
  startDate: string;
  endDate: string;
  notes?: string;
}) => call<{ id: string }>('/bookings', { method: 'POST', body: JSON.stringify(body) });

export const changeBooking = (
  bookingId: string,
  body: { startDate?: string; endDate?: string; notes?: string },
) => call<{ ok: boolean }>(`/bookings/${bookingId}`, { method: 'PATCH', body: JSON.stringify(body) });

export const cancelBooking = (bookingId: string, reason?: string) =>
  call<{ ok: boolean }>(`/bookings/${bookingId}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });

export const fetchStayLog = (bookingId: string) => call<StayLog>(`/bookings/${bookingId}/log`);

export const fetchAlerts = () => call<{ alerts: PortalAlert[] }>('/alerts');

/**
 * Resize client-side before upload. Photos are stored inline for now, so a
 * 4 MB phone snap would blow the request limit and bloat the row.
 */
export async function fileToPhotoDataUrl(file: File, max = 640): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}
