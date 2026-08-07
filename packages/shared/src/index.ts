export type ServiceType = 'boarding' | 'daycare';

export type BookingStatus =
  | 'requested'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'canceled';

export type RunKind = 'suite' | 'run' | 'playgroup';

export interface TenantTheme {
  appName: string;
  logoInitials: string;
  primary: string;
  primaryDeep: string;
  accent: string;
  accentText: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: 'free' | 'pro';
  theme: TenantTheme;
}

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  smsOptIn: boolean;
  emergencyName: string | null;
  emergencyPhone: string | null;
  balanceCents: number;
  createdAt: string;
}

export interface Pet {
  id: string;
  clientId: string;
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
  createdAt: string;
}

export interface Vaccination {
  id: string;
  petId: string;
  vaccine: string;
  expiresOn: string;
  verified: boolean;
}

export interface Run {
  id: string;
  code: string;
  zone: string;
  kind: RunKind;
  capacity: number;
  displayOrder: number;
}

export interface Booking {
  id: string;
  petId: string;
  clientId: string;
  serviceType: ServiceType;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  runId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface BoardCell {
  run: Run;
  occupants: Array<{
    booking: Booking;
    petName: string;
    petBreed: string | null;
    avatarColor: string;
    hasMeds: boolean;
    isNewClient: boolean;
    nightNumber: number | null;
    totalNights: number | null;
  }>;
}

export interface DashboardStats {
  occupancy: { occupied: number; capacity: number; daycareOnly: number };
  arrivalsToday: number;
  departuresToday: number;
  next7Days: Array<{ date: string; boarding: number; daycare: number }>;
}
