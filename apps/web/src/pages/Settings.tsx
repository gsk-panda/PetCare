import { useCallback, useEffect, useState } from 'react';
import {
  createPlayGroup,
  fetchPlayGroups,
  updatePlayGroup,
  type PlayGroupSetting,
} from '../api';
import { Icon } from '../components/Icon';

export function Settings() {
  const [groups, setGroups] = useState<PlayGroupSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
      </div>
    </>
  );
}
