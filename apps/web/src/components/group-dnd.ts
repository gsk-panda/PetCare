/**
 * The drag contract for moving a dog between play groups, shared by the
 * facility board and the daycare calendar so the two cannot drift apart.
 *
 * A named MIME type matters: during dragover the only thing a drop target can
 * inspect is `dataTransfer.types`, so that is what decides whether the drop is
 * allowed. Reading React state there does not work — state set in dragstart
 * has not flushed by the first dragover, and gating preventDefault on it makes
 * the browser refuse the drop outright.
 */
export const GROUP_DRAG_TYPE = 'application/x-petcare-booking';

export interface GroupDragPayload {
  bookingId: string;
  petName: string;
  /** null when the dog has not been placed in a group yet. */
  fromRunId: string | null;
  /** Moving a dog never changes which day it attends, so drops are refused
   *  across days rather than silently rewriting the booking's date. */
  date: string;
}

export function readGroupDrag(dt: DataTransfer): GroupDragPayload | null {
  const raw = dt.getData(GROUP_DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GroupDragPayload;
  } catch {
    return null;
  }
}

export function writeGroupDrag(dt: DataTransfer, payload: GroupDragPayload): void {
  dt.setData(GROUP_DRAG_TYPE, JSON.stringify(payload));
  dt.effectAllowed = 'move';
}
