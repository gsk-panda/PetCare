import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  checkIn,
  fetchPet,
  type BoardOccupant,
  type PetProfile,
  type StayMedication,
} from '../api';

const DAY_MS = 86_400_000;

function daysUntil(iso: string): number {
  const then = new Date(iso + 'T12:00:00').getTime();
  const now = new Date().setHours(12, 0, 0, 0);
  return Math.round((then - now) / DAY_MS);
}

const BELONGING_PRESETS = [
  'Leash', 'Collar', 'Harness', 'Bed', 'Blanket', 'Toys', 'Food container', 'Bowl',
];
const COLLAR_TYPES = [
  'Flat buckle', 'Martingale', 'Harness', 'Slip lead', 'Head halter', 'None — owner took it',
];
const BOWL_TYPES = ['Standard', 'Slow-feed', 'Elevated', 'Shallow / flat-face'];
const FEEDING_TIMES = ['AM', 'Midday', 'PM', 'Bedtime'];
const MED_SCHEDULES = ['AM', 'PM', 'AM + PM', 'Midday', 'Every 8 hours', 'As needed'];

interface Props {
  occupant: BoardOccupant;
  runCode: string;
  onClose: () => void;
  onCheckedIn: () => void;
}

/**
 * Drop-off intake. The checkboxes record what the desk confirmed; the fields
 * around them record the detail the kennel techs need during the stay — what
 * came in the bag, how this pet eats, and the medication schedule.
 */
export function CheckInPanel({ occupant, runCode, onClose, onCheckedIn }: Props) {
  const [pet, setPet] = useState<PetProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Checklist
  const [vaccinesVerified, setVaccinesVerified] = useState(false);
  const [feedingConfirmed, setFeedingConfirmed] = useState(false);
  const [medsConfirmed, setMedsConfirmed] = useState(false);
  const [signatureCaptured, setSignatureCaptured] = useState(false);

  // Intake
  const [belongings, setBelongings] = useState<string[]>([]);
  const [belongingsNote, setBelongingsNote] = useState('');
  const [collarType, setCollarType] = useState('Flat buckle');
  const [foodSource, setFoodSource] = useState<'owner' | 'house'>('owner');
  const [foodDescription, setFoodDescription] = useState('');
  const [feedingAmount, setFeedingAmount] = useState('');
  const [feedingTimes, setFeedingTimes] = useState<string[]>(['AM', 'PM']);
  const [bowlType, setBowlType] = useState('Standard');
  const [treatsAllowed, setTreatsAllowed] = useState(true);
  const [treatsNotes, setTreatsNotes] = useState('');
  const [bonesAllowed, setBonesAllowed] = useState(false);
  const [bonesNotes, setBonesNotes] = useState('');
  const [needsMeds, setNeedsMeds] = useState(false);
  const [meds, setMeds] = useState<StayMedication[]>([]);

  useEffect(() => {
    fetchPet(occupant.petId)
      .then((p) => {
        setPet(p);
        // Prefill from the standing profile so the desk edits rather than types.
        if (p.feedingNotes) setFoodDescription(p.feedingNotes);
        if (p.medicationNotes) {
          setNeedsMeds(true);
          setMeds([{ name: p.medicationNotes, dose: '', schedule: 'AM', withFood: true }]);
        }
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [occupant.petId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const expired = pet?.vaccinations.filter((v) => daysUntil(v.expiresOn) < 0) ?? [];
  const expiringSoon =
    pet?.vaccinations.filter((v) => {
      const d = daysUntil(v.expiresOn);
      return d >= 0 && d <= 45;
    }) ?? [];
  // The case a check-in-time check alone misses: compliant on arrival, expired
  // before pickup.
  const expiringDuringStay = (pet?.vaccinations ?? []).filter(
    (v) =>
      daysUntil(v.expiresOn) >= 0 &&
      v.expiresOn >= occupant.startDate &&
      v.expiresOn <= occupant.endDate,
  );

  const namedMeds = meds.filter((m) => m.name.trim());
  const medsIncomplete = needsMeds && namedMeds.length === 0;

  const ready =
    Boolean(pet) &&
    vaccinesVerified &&
    feedingConfirmed &&
    signatureCaptured &&
    !medsIncomplete &&
    (!needsMeds || medsConfirmed);

  const updateMed = (i: number, patch: Partial<StayMedication>) =>
    setMeds((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setSubmitError(null);
    const belongingsText = [belongings.join(', '), belongingsNote.trim()]
      .filter(Boolean)
      .join(' · ');
    try {
      await checkIn(occupant.bookingId, {
        vaccinesVerified,
        feedingConfirmed,
        medsConfirmed,
        signatureCaptured,
        intake: {
          belongings: belongingsText || undefined,
          collarType,
          foodSource,
          foodDescription: foodDescription.trim() || undefined,
          feedingAmount: feedingAmount.trim() || undefined,
          feedingTimes,
          bowlType,
          treatsAllowed,
          treatsNotes: treatsNotes.trim() || undefined,
          bonesAllowed,
          bonesNotes: bonesNotes.trim() || undefined,
          medications: needsMeds ? namedMeds : [],
        },
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
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Check in ${occupant.petName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">
          <b>Check in · {occupant.petName}</b>
          <span className="pill prim" style={{ marginLeft: 8 }}>{runCode}</span>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {loadError ? (
          <div className="hint error">Could not load pet details: {loadError}</div>
        ) : !pet ? (
          <div className="hint">Loading pet details…</div>
        ) : (
          <>
            <div className="modal-body">
              <p className="checkin-sub">
                {pet.breed ?? pet.species}
                {' · '}
                {occupant.serviceType === 'boarding'
                  ? `${occupant.totalNights ?? ''} night stay`
                  : 'daycare'}
                {' · owner '}
                {pet.owner.name}
                {' · '}
                <Link to={`/pets/${pet.id}`} className="linkish">full profile</Link>
              </p>

              {expired.length > 0 && (
                <div className="form-error">
                  {expired.map((v) => v.vaccine).join(', ')} expired. Get an updated record
                  before this pet joins a group.
                </div>
              )}
              {expiringDuringStay.length > 0 && (
                <div className="stay-expiry-warning">
                  <b>Expires during this stay</b>
                  <ul>
                    {expiringDuringStay.map((v) => (
                      <li key={v.id}>
                        {v.vaccine} expires {v.expiresOn} — {daysUntil(v.expiresOn)} day
                        {daysUntil(v.expiresOn) === 1 ? '' : 's'} in, before pickup on{' '}
                        {occupant.endDate}
                      </li>
                    ))}
                  </ul>
                  <small>
                    Get an updated record from the owner at drop-off. This pet is compliant
                    today but will not be for the whole stay.
                  </small>
                </div>
              )}
              {pet.allergyNotes && (
                <div className="allergy-note"><b>Allergy</b> · {pet.allergyNotes}</div>
              )}

              {/* --- Verification ------------------------------------------ */}
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
                        ? expiringSoon
                            .map((v) => `${v.vaccine} in ${daysUntil(v.expiresOn)}d`)
                            .join(', ')
                        : 'All records current'}
                  </small>
                </span>
              </label>

              {/* --- Belongings -------------------------------------------- */}
              <fieldset className="intake">
                <legend>Belongings</legend>
                <div className="chipset">
                  {BELONGING_PRESETS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={belongings.includes(item) ? 'chip on' : 'chip'}
                      onClick={() => setBelongings((b) => toggle(b, item))}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <input
                  className="check-input"
                  value={belongingsNote}
                  onChange={(e) => setBelongingsNote(e.target.value)}
                  placeholder="Anything else — quantities, brand, distinguishing marks"
                />
                <label className="inline-field">
                  <span>Collar type</span>
                  <select value={collarType} onChange={(e) => setCollarType(e.target.value)}>
                    {COLLAR_TYPES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
              </fieldset>

              {/* --- Feeding ----------------------------------------------- */}
              <fieldset className="intake">
                <legend>Feeding</legend>
                <div className="segmented small">
                  <button
                    type="button"
                    className={foodSource === 'owner' ? 'on' : ''}
                    onClick={() => setFoodSource('owner')}
                  >
                    Owner-provided
                  </button>
                  <button
                    type="button"
                    className={foodSource === 'house' ? 'on' : ''}
                    onClick={() => setFoodSource('house')}
                  >
                    House food
                  </button>
                </div>
                <input
                  className="check-input"
                  value={foodDescription}
                  onChange={(e) => setFoodDescription(e.target.value)}
                  placeholder="Food — brand, formula, any mixing instructions"
                />
                <div className="field-row">
                  <label className="inline-field">
                    <span>Amount per meal</span>
                    <input
                      value={feedingAmount}
                      onChange={(e) => setFeedingAmount(e.target.value)}
                      placeholder="2 cups"
                    />
                  </label>
                  <label className="inline-field">
                    <span>Bowl</span>
                    <select value={bowlType} onChange={(e) => setBowlType(e.target.value)}>
                      {BOWL_TYPES.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                </div>
                <div className="sub-label">Feeding times</div>
                <div className="chipset">
                  {FEEDING_TIMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={feedingTimes.includes(t) ? 'chip on' : 'chip'}
                      onClick={() => setFeedingTimes((f) => toggle(f, t))}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* --- Treats & bones ---------------------------------------- */}
              <fieldset className="intake">
                <legend>Treats &amp; chews</legend>
                <label className="check-row compact">
                  <input
                    type="checkbox"
                    checked={treatsAllowed}
                    onChange={(e) => setTreatsAllowed(e.target.checked)}
                  />
                  <span><b>Treats allowed</b></span>
                </label>
                {treatsAllowed && (
                  <input
                    className="check-input"
                    value={treatsNotes}
                    onChange={(e) => setTreatsNotes(e.target.value)}
                    placeholder="Owner-supplied only, grain-free, max 2/day…"
                  />
                )}
                <label className="check-row compact">
                  <input
                    type="checkbox"
                    checked={bonesAllowed}
                    onChange={(e) => setBonesAllowed(e.target.checked)}
                  />
                  <span><b>Bones / chews allowed</b></span>
                </label>
                {bonesAllowed && (
                  <input
                    className="check-input"
                    value={bonesNotes}
                    onChange={(e) => setBonesNotes(e.target.value)}
                    placeholder="Bully stick at bedtime, only when crated alone…"
                  />
                )}
              </fieldset>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={feedingConfirmed}
                  onChange={(e) => setFeedingConfirmed(e.target.checked)}
                />
                <span>
                  <b>Feeding plan confirmed with owner</b>
                  <small>
                    {feedingTimes.length
                      ? `${feedingAmount || 'amount TBD'} · ${feedingTimes.join(', ')}`
                      : 'No feeding times selected'}
                  </small>
                </span>
              </label>

              {/* --- Medication -------------------------------------------- */}
              <fieldset className="intake">
                <legend>Medication</legend>
                <label className="check-row compact">
                  <input
                    type="checkbox"
                    checked={needsMeds}
                    onChange={(e) => {
                      setNeedsMeds(e.target.checked);
                      if (e.target.checked && meds.length === 0) {
                        setMeds([{ name: '', dose: '', schedule: 'AM', withFood: true }]);
                      }
                    }}
                  />
                  <span>
                    <b>This pet needs medication during the stay</b>
                    <small>
                      {pet.medicationNotes
                        ? `Profile says: ${pet.medicationNotes}`
                        : 'Nothing on the profile — confirm with the owner'}
                    </small>
                  </span>
                </label>

                {needsMeds && (
                  <>
                    {meds.map((m, i) => (
                      <div className="med-row" key={i}>
                        <div className="field-row">
                          <label className="inline-field">
                            <span>Medication</span>
                            <input
                              value={m.name}
                              onChange={(e) => updateMed(i, { name: e.target.value })}
                              placeholder="Carprofen"
                            />
                          </label>
                          <label className="inline-field">
                            <span>Dose</span>
                            <input
                              value={m.dose ?? ''}
                              onChange={(e) => updateMed(i, { dose: e.target.value })}
                              placeholder="75 mg · 1 tablet"
                            />
                          </label>
                        </div>
                        <div className="field-row">
                          <label className="inline-field">
                            <span>Schedule</span>
                            <select
                              value={m.schedule ?? 'AM'}
                              onChange={(e) => updateMed(i, { schedule: e.target.value })}
                            >
                              {MED_SCHEDULES.map((s) => <option key={s}>{s}</option>)}
                            </select>
                          </label>
                          <label className="inline-field">
                            <span>With food</span>
                            <select
                              value={m.withFood === false ? 'no' : 'yes'}
                              onChange={(e) => updateMed(i, { withFood: e.target.value === 'yes' })}
                            >
                              <option value="yes">Yes — give with meal</option>
                              <option value="no">No — any time</option>
                            </select>
                          </label>
                        </div>
                        <input
                          className="check-input"
                          value={m.notes ?? ''}
                          onChange={(e) => updateMed(i, { notes: e.target.value })}
                          placeholder="Hide in cheese; owner supplied 6 doses"
                        />
                        {meds.length > 1 && (
                          <button
                            type="button"
                            className="med-remove"
                            onClick={() => setMeds((prev) => prev.filter((_, idx) => idx !== i))}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() =>
                        setMeds((prev) => [
                          ...prev,
                          { name: '', dose: '', schedule: 'AM', withFood: true },
                        ])
                      }
                    >
                      + Add another medication
                    </button>

                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={medsConfirmed}
                        onChange={(e) => setMedsConfirmed(e.target.checked)}
                      />
                      <span>
                        <b>Medication received and schedule confirmed</b>
                        <small>
                          {namedMeds.length
                            ? namedMeds
                                .map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''} · ${m.schedule}`)
                                .join(' | ')
                            : 'Add at least one medication above'}
                        </small>
                      </span>
                    </label>
                  </>
                )}
              </fieldset>

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
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
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
