import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchPet, type PetProfile as PetProfileData } from '../api';

const DAY_MS = 86_400_000;

function daysUntil(iso: string): number {
  const then = new Date(iso + 'T12:00:00').getTime();
  const now = new Date().setHours(12, 0, 0, 0);
  return Math.round((then - now) / DAY_MS);
}

/** Reminder window: vaccines inside this many days get an automated nudge. */
const REMINDER_WINDOW_DAYS = 45;

function vaccineStatus(expiresOn: string, verified: boolean) {
  const days = daysUntil(expiresOn);
  if (days < 0) return <span className="pill bad">Expired {Math.abs(days)}d ago</span>;
  if (days <= REMINDER_WINDOW_DAYS)
    return <span className="pill warn">{days}d · reminder queued</span>;
  if (!verified) return <span className="pill info">Unverified</span>;
  return <span className="pill good">Current</span>;
}

function ageFrom(birthdate: string | null): string | null {
  if (!birthdate) return null;
  const years = Math.floor((Date.now() - new Date(birthdate).getTime()) / (365.25 * DAY_MS));
  return `${years} yr${years === 1 ? '' : 's'}`;
}

export function PetProfile() {
  const { petId } = useParams<{ petId: string }>();
  const [pet, setPet] = useState<PetProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!petId) return;
    setPet(null);
    setError(null);
    fetchPet(petId)
      .then(setPet)
      .catch((e: Error) => setError(e.message));
  }, [petId]);

  if (error) return <div className="hint error">Could not load pet: {error}</div>;
  if (!pet) return <div className="hint">Loading pet…</div>;

  const stayIntake = pet.currentStay?.intake ?? null;
  const stayMeds = pet.currentStay?.medications ?? [];
  const age = ageFrom(pet.birthdate);
  const expiringSoon = pet.vaccinations.some(
    (v) => daysUntil(v.expiresOn) <= REMINDER_WINDOW_DAYS,
  );
  const detail = [
    pet.breed,
    pet.sex,
    age,
    pet.weightLbs !== null ? `${pet.weightLbs} lb` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="pethead">
        <span className="bigav" style={{ background: pet.avatarColor }}>
          {pet.name[0]}
        </span>
        <div>
          <h1>{pet.name}</h1>
          <div className="sub">
            {detail || pet.species} · Owner:{' '}
            <Link to="/clients" className="linkish">
              {pet.owner.name}
            </Link>
          </div>
          <div className="tagrow">
            {expiringSoon ? (
              <span className="pill warn">Vaccine expiring</span>
            ) : (
              <span className="pill good">Vaccines current</span>
            )}
            {pet.medicationNotes && <span className="pill bad">Daily meds</span>}
            {pet.allergyNotes && <span className="pill info">Allergies</span>}
          </div>
        </div>
        <div className="actions">
          <Link to="/board" className="btn ghost">
            Back to board
          </Link>
          <button className="btn">Book stay</button>
        </div>
      </div>

      <div className="content">
        <div className="grid2">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card">
              <div className="hd">
                <b>Vaccine records</b>
                <span className="cnt">{pet.vaccinations.length}</span>
              </div>
              {pet.vaccinations.length === 0 ? (
                <div className="hint">No vaccine records on file.</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Vaccine</th>
                      <th>Expires</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pet.vaccinations.map((v) => (
                      <tr key={v.id}>
                        <td>{v.vaccine}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {new Date(v.expiresOn + 'T12:00:00').toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td>{vaccineStatus(v.expiresOn, v.verified)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <div className="hd">
                <b>Standing care plan</b>
              </div>
              <dl className="kv">
                <dt>Feeding</dt>
                <dd>{pet.feedingNotes ?? 'House food, standard portions'}</dd>
                <dt>Medication</dt>
                <dd>{pet.medicationNotes ?? 'None'}</dd>
                <dt>Allergies</dt>
                <dd>{pet.allergyNotes ?? 'None recorded'}</dd>
              </dl>
            </div>

            {stayIntake && (
              <div className="card">
                <div className="hd">
                  <b>This stay · drop-off intake</b>
                  {pet.currentStay?.runCode && (
                    <span className="pill prim">{pet.currentStay.runCode}</span>
                  )}
                </div>
                <dl className="kv">
                  <dt>Belongings</dt>
                  <dd>{stayIntake.belongings ?? 'Nothing logged'}</dd>
                  <dt>Collar</dt>
                  <dd>{stayIntake.collarType ?? '—'}</dd>
                  <dt>Food</dt>
                  <dd>
                    {stayIntake.foodSource === 'house' ? 'House food' : 'Owner-provided'}
                    {stayIntake.foodDescription ? ` · ${stayIntake.foodDescription}` : ''}
                  </dd>
                  <dt>Feeding</dt>
                  <dd>
                    {[
                      stayIntake.feedingAmount,
                      stayIntake.feedingTimes.join(', ') || null,
                      stayIntake.bowlType ? `${stayIntake.bowlType} bowl` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </dd>
                  <dt>Treats</dt>
                  <dd>
                    {stayIntake.treatsAllowed ? 'Allowed' : 'Not allowed'}
                    {stayIntake.treatsNotes ? ` · ${stayIntake.treatsNotes}` : ''}
                  </dd>
                  <dt>Bones / chews</dt>
                  <dd>
                    {stayIntake.bonesAllowed ? 'Allowed' : 'Not allowed'}
                    {stayIntake.bonesNotes ? ` · ${stayIntake.bonesNotes}` : ''}
                  </dd>
                  <dt>Recorded</dt>
                  <dd>
                    {stayIntake.recordedBy ?? 'front desk'} ·{' '}
                    {new Date(stayIntake.recordedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </dd>
                </dl>
              </div>
            )}

            {stayMeds.length > 0 && (
              <div className="card">
                <div className="hd">
                  <b>Medication schedule · this stay</b>
                  <span className="cnt">{stayMeds.length}</span>
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Medication</th>
                      <th>Dose</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stayMeds.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <b>{m.name}</b>
                          {m.notes && <small style={{ display: 'block', color: 'var(--p-ink-soft)' }}>{m.notes}</small>}
                        </td>
                        <td>{m.dose ?? '—'}</td>
                        <td>
                          {m.schedule}
                          <small style={{ display: 'block', color: 'var(--p-ink-soft)' }}>
                            {m.withFood ? 'with food' : 'any time'}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="hd">
              <b>Owner · {pet.owner.name}</b>
            </div>
            <dl className="kv">
              <dt>Phone</dt>
              <dd>{pet.owner.phone ?? '—'}</dd>
              <dt>Emergency</dt>
              <dd>
                {pet.owner.emergencyName
                  ? `${pet.owner.emergencyName} · ${pet.owner.emergencyPhone ?? ''}`
                  : 'Not on file'}
              </dd>
              <dt>Balance</dt>
              <dd style={{ color: pet.owner.balanceCents > 0 ? 'var(--p-good)' : undefined }}>
                {pet.owner.balanceCents > 0
                  ? `$${(pet.owner.balanceCents / 100).toFixed(2)} credit`
                  : '$0.00'}
              </dd>
            </dl>
          </div>
        </div>
      </div>
    </>
  );
}
