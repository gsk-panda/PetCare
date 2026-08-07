import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkIn, fetchPet, type BoardOccupant, type PetProfile } from '../api';

const DAY_MS = 86_400_000;

function daysUntil(iso: string): number {
  const then = new Date(iso + 'T12:00:00').getTime();
  const now = new Date().setHours(12, 0, 0, 0);
  return Math.round((then - now) / DAY_MS);
}

interface Props {
  occupant: BoardOccupant;
  runCode: string;
  onClose: () => void;
  onCheckedIn: () => void;
}

/**
 * Front-desk check-in checklist. Everything the kennel techs need confirmed at
 * drop-off, with the pet's own feeding and medication plan shown inline so the
 * desk is not checking boxes from memory.
 */
export function CheckInPanel({ occupant, runCode, onClose, onCheckedIn }: Props) {
  const [pet, setPet] = useState<PetProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [vaccinesVerified, setVaccinesVerified] = useState(false);
  const [belongings, setBelongings] = useState('');
  const [belongingsLogged, setBelongingsLogged] = useState(false);
  const [feedingConfirmed, setFeedingConfirmed] = useState(false);
  const [medsConfirmed, setMedsConfirmed] = useState(false);
  const [signatureCaptured, setSignatureCaptured] = useState(false);

  useEffect(() => {
    fetchPet(occupant.petId)
      .then(setPet)
      .catch((e: Error) => setLoadError(e.message));
  }, [occupant.petId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const expired = pet?.vaccinations.filter((v) => daysUntil(v.expiresOn) < 0) ?? [];
  const expiringSoon =
    pet?.vaccinations.filter((v) => {
      const d = daysUntil(v.expiresOn);
      return d >= 0 && d <= 45;
    }) ?? [];
  const needsMeds = Boolean(pet?.medicationNotes);

  const ready =
    Boolean(pet) &&
    vaccinesVerified &&
    feedingConfirmed &&
    signatureCaptured &&
    (!needsMeds || medsConfirmed);

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await checkIn(occupant.bookingId, {
        belongings: belongingsLogged ? belongings : undefined,
        feedingConfirmed,
        medsConfirmed,
        vaccinesVerified,
        signatureCaptured,
      });
      onCheckedIn();
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Check in ${occupant.petName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">
          <b>Check in · {occupant.petName}</b>
          <span className="pill prim" style={{ marginLeft: 8 }}>
            {runCode}
          </span>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {loadError ? (
          <div className="hint error">Could not load pet details: {loadError}</div>
        ) : !pet ? (
          <div className="hint">Loading pet details…</div>
        ) : (
          <>
            <div className="modal-body">
              <p className="checkin-sub">
                {pet.breed ?? pet.species} · {occupant.serviceType === 'boarding'
                  ? `${occupant.totalNights ?? ''} night stay`
                  : 'daycare'}{' '}
                · owner {pet.owner.name}
                {' · '}
                <Link to={`/pets/${pet.id}`} className="linkish">
                  full profile
                </Link>
              </p>

              {expired.length > 0 && (
                <div className="form-error">
                  {expired.map((v) => v.vaccine).join(', ')} expired. Get an updated record
                  before this pet joins a group.
                </div>
              )}

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={vaccinesVerified}
                  onChange={(e) => setVaccinesVerified(e.target.checked)}
                />
                <span>
                  <b>Vaccines verified</b>
                  <small>
                    {expired.length > 0
                      ? `${expired.length} expired — override requires a manager`
                      : expiringSoon.length > 0
                        ? `${expiringSoon
                            .map((v) => `${v.vaccine} in ${daysUntil(v.expiresOn)}d`)
                            .join(', ')}`
                        : 'All records current'}
                  </small>
                </span>
              </label>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={belongingsLogged}
                  onChange={(e) => setBelongingsLogged(e.target.checked)}
                />
                <span>
                  <b>Belongings logged</b>
                  <small>Leash, bed, toys, food container</small>
                </span>
              </label>
              {belongingsLogged && (
                <input
                  className="check-input"
                  value={belongings}
                  onChange={(e) => setBelongings(e.target.value)}
                  placeholder="1 leash · 1 bed · salmon kibble, 8 cups"
                />
              )}

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={feedingConfirmed}
                  onChange={(e) => setFeedingConfirmed(e.target.checked)}
                />
                <span>
                  <b>Feeding plan confirmed</b>
                  <small>{pet.feedingNotes ?? 'House food, standard portions'}</small>
                </span>
              </label>

              {needsMeds && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={medsConfirmed}
                    onChange={(e) => setMedsConfirmed(e.target.checked)}
                  />
                  <span>
                    <b>Medication logged</b>
                    <small>{pet.medicationNotes}</small>
                  </span>
                </label>
              )}

              {pet.allergyNotes && (
                <div className="allergy-note">
                  <b>Allergy</b> · {pet.allergyNotes}
                </div>
              )}

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={signatureCaptured}
                  onChange={(e) => setSignatureCaptured(e.target.checked)}
                />
                <span>
                  <b>Owner signature at drop-off</b>
                  <small>Confirms care instructions and pickup authorization</small>
                </span>
              </label>

              {submitError && <div className="form-error">{submitError}</div>}
            </div>

            <div className="modal-ft">
              <button type="button" className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={submit} disabled={!ready || saving}>
                {saving ? 'Checking in…' : 'Complete check-in'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
