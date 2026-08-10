import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CARE_SLOTS, SLOT_HOURS, type CareSlot, type CareTask } from '@petcare/shared';
import { completeCareTask, fetchCareTasks, undoCareTask, type CareTasksResponse } from '../api';
import { facilityToday, isoDate } from '../facility-time';


function taskKeyOf(t: CareTask): string {
  return `${t.bookingId}|${t.type}|${t.slot}|${t.subject ?? ''}`;
}

export function CareRounds() {
  const today = facilityToday();
  const [date, setDate] = useState(today);
  const [data, setData] = useState<CareTasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);

  const load = useCallback(() => {
    fetchCareTasks(date)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [date]);
  useEffect(load, [load]);

  const bySlot = useMemo(() => {
    const m = new Map<CareSlot, CareTask[]>();
    for (const slot of CARE_SLOTS) m.set(slot, []);
    for (const t of data?.tasks ?? []) m.get(t.slot)?.push(t);
    return m;
  }, [data]);

  const toggle = async (t: CareTask) => {
    const key = taskKeyOf(t);
    setBusy(key);
    setError(null);
    try {
      const payload = {
        bookingId: t.bookingId,
        type: t.type,
        slot: t.slot,
        subject: t.subject,
        date,
      };
      if (t.done) await undoCareTask(payload);
      else await completeCareTask(payload);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const completeSlot = async (slot: CareSlot) => {
    const pending = (bySlot.get(slot) ?? []).filter((t) => !t.done);
    if (pending.length === 0) return;
    if (!window.confirm(`Log all ${pending.length} outstanding ${slot} rounds as given?`)) return;
    setBusy(`slot:${slot}`);
    try {
      for (const t of pending) {
        await completeCareTask({
          bookingId: t.bookingId,
          type: t.type,
          slot: t.slot,
          subject: t.subject,
          date,
        });
      }
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const nowHour = new Date().getHours();

  return (
    <>
      <div className="topbar">
        <h1>Care rounds</h1>
        <input
          className="date-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Care date"
        />
        <div className="right">
          <label className="toggle">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            Hide completed
          </label>
          <Link to="/reports/care-log" className="btn ghost">
            Daily log report
          </Link>
        </div>
      </div>

      <div className="content">
        {error && <div className="form-error">{error}</div>}

        {data && (
          <div className="tiles">
            <div className="tile">
              <div className="lbl">Rounds today</div>
              <div className="num">
                {data.summary.done} / {data.summary.total}
              </div>
              <div className="sub">given</div>
              <div className="meter">
                <i
                  style={{
                    width: `${data.summary.total ? (data.summary.done / data.summary.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <div className="tile">
              <div className="lbl">Medication outstanding</div>
              <div
                className="num"
                style={{
                  color: data.summary.medicationOutstanding
                    ? 'var(--p-bad)'
                    : 'var(--p-good)',
                }}
              >
                {data.summary.medicationOutstanding}
              </div>
              <div className="sub">doses not yet logged</div>
            </div>
            <div className="tile">
              <div className="lbl">Feeding outstanding</div>
              <div className="num">
                {data.tasks.filter((t) => t.type === 'feeding' && !t.done).length}
              </div>
              <div className="sub">meals not yet logged</div>
            </div>
            <div className="tile">
              <div className="lbl">Pets in care</div>
              <div className="num">{new Set(data.tasks.map((t) => t.petId)).size}</div>
              <div className="sub">with a care plan</div>
            </div>
          </div>
        )}

        {!data ? (
          <div className="hint">Loading rounds…</div>
        ) : data.tasks.length === 0 ? (
          <div className="hint">
            No scheduled feeding or medication for this date. Rounds come from the drop-off
            intake captured at check-in.
          </div>
        ) : (
          CARE_SLOTS.map((slot) => {
            const tasks = bySlot.get(slot) ?? [];
            if (tasks.length === 0) return null;
            const pending = tasks.filter((t) => t.done === false);
            const shown = hideDone ? pending : tasks;
            const overdue = date === today && pending.length > 0 && nowHour > SLOT_HOURS[slot];
            return (
              <section key={slot} className="card">
                <div className="hd">
                  <b>{slot} round</b>
                  <span className="cnt">
                    {tasks.length - pending.length} / {tasks.length}
                  </span>
                  {overdue && <span className="pill bad">Overdue</span>}
                  {pending.length > 0 && (
                    <button
                      className="btn ghost"
                      style={{ marginLeft: 'auto' }}
                      disabled={busy === `slot:${slot}`}
                      onClick={() => completeSlot(slot)}
                    >
                      {busy === `slot:${slot}` ? 'Logging…' : `Log all ${pending.length}`}
                    </button>
                  )}
                </div>
                {shown.length === 0 ? (
                  <div className="hint">All {slot} rounds logged.</div>
                ) : (
                  <ul className="tasklist">
                    {shown.map((t) => {
                      const key = taskKeyOf(t);
                      return (
                        <li key={key} className={t.done ? 'done' : ''}>
                          <button
                            className={`taskbox${t.done ? ' on' : ''}`}
                            disabled={busy === key}
                            onClick={() => toggle(t)}
                            aria-label={`${t.done ? 'Undo' : 'Log'} ${t.type} for ${t.petName}`}
                          />
                          <span className="pav" style={{ background: t.avatarColor }}>
                            {t.petName[0]}
                          </span>
                          <span className="taskmain">
                            <b>
                              <Link to={`/pets/${t.petId}`} className="linkish">
                                {t.petName}
                              </Link>
                              {t.runCode && <em className="taskrun">{t.runCode}</em>}
                              {t.type === 'medication' && (
                                <span className="pill bad" style={{ marginLeft: 6 }}>
                                  {t.subject}
                                </span>
                              )}
                            </b>
                            <small>{t.detail}</small>
                          </span>
                          <span className="taskmeta">
                            {t.done ? (
                              <>
                                Given{' '}
                                {t.doneAt
                                  ? new Date(t.doneAt).toLocaleTimeString(undefined, {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })
                                  : ''}
                                {t.doneBy ? ` · ${t.doneBy}` : ''}
                              </>
                            ) : (
                              <em>{t.type === 'medication' ? 'Dose due' : 'Meal due'}</em>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
