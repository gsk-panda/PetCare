import { useRef, useState } from 'react';
import type { PortalData } from './PortalApp';
import { Avatar } from './PortalHome';
import { addVaccination, fileToPhotoDataUrl, updatePet, type PortalPet } from './api';

const DAY_MS = 86_400_000;

function daysUntil(iso: string): number {
  return Math.round(
    (new Date(iso + 'T12:00:00').getTime() - new Date().setHours(12, 0, 0, 0)) / DAY_MS,
  );
}

export function PortalPets({ data, reload }: { data: PortalData; reload: () => Promise<void> }) {
  return (
    <div className="pt-page">
      <div className="pt-page-hd">
        <h2>My pets</h2>
      </div>
      {data.pets.map((pet) => (
        <PetCard key={pet.id} pet={pet} reload={reload} />
      ))}
    </div>
  );
}

function PetCard({ pet, reload }: { pet: PortalPet; reload: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [feeding, setFeeding] = useState(pet.feedingNotes ?? '');
  const [meds, setMeds] = useState(pet.medicationNotes ?? '');
  const [allergies, setAllergies] = useState(pet.allergyNotes ?? '');
  const [weight, setWeight] = useState(pet.weightLbs === null ? '' : String(pet.weightLbs));

  const [vaccine, setVaccine] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [addingVax, setAddingVax] = useState(false);

  const flash = (msg: string) => {
    setSaved(msg);
    window.setTimeout(() => setSaved(null), 2500);
  };

  const saveDetails = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = weight.trim() === '' ? null : Number(weight);
      await updatePet(pet.id, {
        feedingNotes: feeding,
        medicationNotes: meds,
        allergyNotes: allergies,
        weightLbs: w,
      });
      await reload();
      flash('Saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToPhotoDataUrl(file);
      await updatePet(pet.id, { photoUrl: dataUrl });
      await reload();
      flash('Photo updated');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitVax = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addVaccination(pet.id, vaccine.trim(), expiresOn);
      setVaccine('');
      setExpiresOn('');
      setAddingVax(false);
      await reload();
      flash('Vaccination added — we will verify it at drop-off');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pt-card">
      <div className="pt-pethd">
        <button
          className="pt-photo-btn"
          onClick={() => fileRef.current?.click()}
          aria-label={`Change ${pet.name}'s photo`}
        >
          <Avatar name={pet.name} color={pet.avatarColor} photo={pet.photoUrl} size={64} />
          <span>{pet.photoUrl ? 'Change' : 'Add photo'}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPhoto(f);
            e.target.value = '';
          }}
        />
        <div>
          <h3>{pet.name}</h3>
          <p>
            {[pet.breed, pet.sex === 'M' ? 'Male' : pet.sex === 'F' ? 'Female' : null]
              .filter(Boolean)
              .join(' · ') || pet.species}
          </p>
        </div>
      </div>

      {error && <div className="pt-error inline">{error}</div>}
      {saved && <div className="pt-saved">{saved}</div>}

      <div className="pt-sub">
        <h4>Vaccinations</h4>
        {pet.vaccinations.length === 0 ? (
          <p className="pt-fine">Nothing on file yet.</p>
        ) : (
          <ul className="pt-plain">
            {pet.vaccinations.map((v) => {
              const d = daysUntil(v.expiresOn);
              return (
                <li key={v.id}>
                  <b>{v.vaccine}</b> · expires {v.expiresOn}
                  {d < 0 ? (
                    <span className="pt-pill off">Expired</span>
                  ) : d <= 45 ? (
                    <span className="pt-pill pending">{d}d left</span>
                  ) : null}
                  {!v.verified && <span className="pt-pill pending">Awaiting check</span>}
                </li>
              );
            })}
          </ul>
        )}
        {addingVax ? (
          <form className="pt-inline-form" onSubmit={submitVax}>
            <label className="pt-field">
              <span>Vaccine</span>
              <input
                value={vaccine}
                onChange={(e) => setVaccine(e.target.value)}
                placeholder="Bordetella"
                required
                autoFocus
              />
            </label>
            <label className="pt-field">
              <span>Expires</span>
              <input
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                required
              />
            </label>
            <div className="pt-actions">
              <button type="button" className="pt-link" onClick={() => setAddingVax(false)}>
                Cancel
              </button>
              <button className="pt-btn small" type="submit" disabled={busy}>
                Add
              </button>
            </div>
          </form>
        ) : (
          <button className="pt-link" onClick={() => setAddingVax(true)}>
            Add a vaccination record
          </button>
        )}
      </div>

      <div className="pt-sub">
        <h4>Care details</h4>
        <label className="pt-field">
          <span>Feeding</span>
          <textarea
            rows={2}
            value={feeding}
            onChange={(e) => setFeeding(e.target.value)}
            placeholder="Brand, how much, how often"
          />
        </label>
        <label className="pt-field">
          <span>Medication</span>
          <textarea
            rows={2}
            value={meds}
            onChange={(e) => setMeds(e.target.value)}
            placeholder="What, how much, when — leave blank if none"
          />
        </label>
        <div className="pt-field-row">
          <label className="pt-field">
            <span>Allergies</span>
            <input
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="None"
            />
          </label>
          <label className="pt-field" style={{ maxWidth: 130 }}>
            <span>Weight (lb)</span>
            <input
              type="number"
              min={1}
              max={400}
              value={weight}
              onWheel={(e) => e.currentTarget.blur()}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
        </div>
        <p className="pt-fine">
          We confirm all of this with you at drop-off, so it is never the only record.
        </p>
        <button className="pt-btn small" onClick={saveDetails} disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </section>
  );
}
