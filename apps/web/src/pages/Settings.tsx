import { useCallback, useEffect, useState } from 'react';
import {
  createPlayGroup,
  fetchPlayGroups,
  updatePlayGroup,
  type PlayGroupSetting,
} from '../api';
import { Icon } from '../components/Icon';
import { KennelRuns } from '../components/KennelRuns';
import { BillingSettings } from '../components/BillingSettings';
import { ChangeRequests } from '../components/ChangeRequests';
import { canManageSettings, useStaff } from '../staff-context';

export function Settings() {
  const [groups, setGroups] = useState<PlayGroupSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = canManageSettings(useStaff());
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCapacity, setNewCapacity] = useState('12');

  const load = useCallback(() => {
    fetchPlayGroups()
      .then((r) => setGroups(r.groups))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const patch = async (g: PlayGroupSetting, body: Parameters<typeof updatePlayGroup>[1]) => {
    setBusy(g.id);
    setError(null);
    try {
      await updatePlayGroup(g.id, body);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const capacity = Number(newCapacity);
    if (!newLabel.trim() || !Number.isInteger(capacity)) return;
    setBusy('new');
    setError(null);
    try {
      await createPlayGroup({ label: newLabel.trim(), capacity });
      setNewLabel('');
      setNewCapacity('12');
      setAdding(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const active = groups?.filter((g) => g.active) ?? [];
  const retired = groups?.filter((g) => !g.active) ?? [];

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
        <span className="date">Cedar Creek Pet Lodge</span>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}

        {!canEdit && (
          <div className="readonly-note">
            <b>You're viewing settings read-only</b>
            <small>
              Changing how the facility is set up is an owner or manager job. Ask one of them
              if something here needs to change.
            </small>
          </div>
        )}

        <KennelRuns onError={setError} canEdit={canEdit} />

        <BillingSettings onError={setError} canEdit={canEdit} />

        <div className="card">
          <div className="hd">
            <b>Daycare play groups</b>
            <span className="cnt">{active.length} active</span>
            {!adding && (
              <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>
                <Icon name="plus" size={15} />
                Add group
              </button>
            )}
          </div>

          <p className="setting-note">
            Groups are how daycare dogs are split on the floor. Facilities that run one mixed
            group only need one here — the board and the daycare calendar follow whatever you
            configure.
          </p>

          {adding && (
            <form className="group-add" onSubmit={add}>
              <label className="inline-field">
                <span>Group name</span>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Small dogs"
                  autoFocus
                />
              </label>
              <label className="inline-field" style={{ maxWidth: 130 }}>
                <span>Capacity</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={newCapacity}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) => setNewCapacity(e.target.value)}
                />
              </label>
              <div className="group-add-actions">
                <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={!newLabel.trim() || busy === 'new'}>
                  {busy === 'new' ? 'Adding…' : 'Add group'}
                </button>
              </div>
            </form>
          )}

          {!groups ? (
            <div className="hint">Loading groups…</div>
          ) : active.length === 0 ? (
            <div className="empty">
              <b>No active play groups</b>
              <small>
                Daycare bookings need somewhere to go. Add at least one group — a single mixed
                group is a perfectly normal setup.
              </small>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Capacity</th>
                  <th>Rate / day</th>
                  <th>Booked today</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <input
                        className="cell-input"
                        defaultValue={g.label}
                        aria-label={`Name for ${g.label}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== g.label) patch(g, { label: v });
                        }}
                      />
                      <small className="code-hint">{g.code}</small>
                    </td>
                    <td>
                      <input
                        className="cell-input narrow"
                        type="number"
                        min={1}
                        max={200}
                        defaultValue={g.capacity}
                        aria-label={`Capacity for ${g.label}`}
                        // A focused number input changes value on wheel, so
                        // scrolling the page over it silently edits capacity.
                        onWheel={(e) => e.currentTarget.blur()}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isInteger(v) && v !== g.capacity) patch(g, { capacity: v });
                        }}
                      />
                    </td>
                    <td>
                      <label className="rate-inline">
                        <span>$</span>
                        <input
                          className="cell-input narrow"
                          defaultValue={(g.rateCents / 100).toFixed(2)}
                          readOnly={!canEdit}
                          inputMode="decimal"
                          aria-label={`Daily rate for ${g.label}`}
                          onBlur={(e) => {
                            const n = Number(e.target.value.replace(/[^0-9.]/g, ''));
                            const cents = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
                            if (cents !== null && cents !== g.rateCents) patch(g, { rateCents: cents });
                          }}
                        />
                      </label>
                    </td>
                    <td>
                      {g.bookedToday} / {g.capacity}
                      {g.bookedToday > g.capacity && (
                        <span className="pill bad" style={{ marginLeft: 6 }}>Over</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn ghost"
                        disabled={busy === g.id}
                        onClick={() => patch(g, { active: false })}
                      >
                        Retire
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {retired.length > 0 && (
          <div className="card">
            <div className="hd">
              <b>Retired groups</b>
              <span className="cnt">{retired.length}</span>
            </div>
            <p className="setting-note">
              Kept so past bookings still resolve. Bring one back at any time.
            </p>
            <table className="tbl">
              <tbody>
                {retired.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <b>{g.label}</b>
                      <small className="code-hint">{g.code}</small>
                    </td>
                    <td>cap {g.capacity}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn ghost"
                        disabled={busy === g.id}
                        onClick={() => patch(g, { active: true })}
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Last: everything above configures the software, this one is about
            changing it. */}
        <ChangeRequests onError={setError} canEdit={canEdit} />
      </div>
    </>
  );
}
