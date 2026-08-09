import { createContext, useContext } from 'react';
import type { StaffUser } from './api';

export const StaffContext = createContext<StaffUser | null>(null);

/** The signed-in staff member. Only valid inside the authenticated staff app. */
export function useStaff(): StaffUser {
  const staff = useContext(StaffContext);
  if (!staff) throw new Error('useStaff used outside the signed-in staff app');
  return staff;
}

/** Whether this person may change how the facility is configured. */
export function canManageSettings(staff: StaffUser): boolean {
  return staff.role === 'owner' || staff.role === 'manager';
}
