import { useCallback, useEffect, useState } from 'react';
import {
  createRunType,
  createRuns,
  deleteRun,
  deleteRunType,
  fetchRunTypes,
  updateRun,
  updateRunType,
  type RunSetting,
  type RunTypeSetting,
} from '../api';
import { Icon } from './Icon';

/** Dollars in the field, cents on the wire. */
function toCents(v: string): number | null {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/**
 * Kennel inventory. Retire and delete are deliberately different actions:
 * anything a dog has stayed in retires so past stays still resolve, while a
 * run created by mistake can be removed outright.
 */
export function KennelRuns({
  onError,
  canEdit,
}: {
  onError: (msg: string | null) => void;
  canEdit: boolean;
}) {
  const [types, setTypes] = useState<RunTypeSetting[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingType, setAddingType] = useState(false);
  const [addingRunsTo, setAddingRunsTo] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(() => {
    fetchRunTypes()
      .then((r) => setTypes(r.types))
      .catch((e: Error) => onError(e.message));
  }, [onError]);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    onError(null);
    try {
      await fn();
      load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const visible = types?.filter((t) => t.active || showRetired) ?? [];
  const retiredCount = types?.filter((t) => !t.active).length ?? 0;

  return (
    <div className="card">
      <div className="hd">
        <b>Kennel runs</b>
        <span className="cnt">{types?.reduce((n, t) => n + t.activeRunCount, 0) ?? 0} active</span>
        {canEdit && !addingType && (
          <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setAddingType(true)}>
            <Icon name="plus" size={15} />
            Add run type
          </button>
        )}
      </div>

      <p className="setting-note">
        A run type is a class of accommodation — a wing of suites, a block of standard runs.
        The board groups by type, and new bookings are offered the runs inside it.
      </p>

      {addingType && (
        <AddTypeForm
          busy={busy === 'new-type'}
          onCancel={() => setAddingType(false)}
          onSubmit={async (body) => {
            await run('new-type', () => createRunType(body));
            setAddingType(false);
          }}
        />
      )}

      {!types ? (
        <div className="hint">Loading kennel layout…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <b>No run types yet</b>
          <small>
            Add a type — a wing of suites, say — then add the runs inside it. Bookings need
            somewhere to go.
          </small>
        </div>
      ) : (
        visible.map((type) => (
          <RunTypeBlock
            key={type.id}
            type={type}
            busy={busy}
            addingRuns={addingRunsTo === type.id}
            onAddRuns={() => setAddingRunsTo(type.id)}
            onCancelAddRuns={() => setAddingRunsTo(null)}
            run={run}
            onRunsAdded={() => setAddingRunsTo(null)}
            canEdit={canEdit}
          />
        ))
      )}

      {retiredCount > 0 && (
        <button className="btn ghost show-retired" onClick={() => setShowRetired((v) => !v)}>
          {showRetired ? 'Hide' : 'Show'} {retiredCount} retired type
          {retiredCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function RunTypeBlock({
  type,
  busy,
  addingRuns,
  onAddRuns,
  onCancelAddRuns,
  onRunsAdded,
  run,
  canEdit,
}: {
  type: RunTypeSetting;
  busy: string | null;
  addingRuns: boolean;
  onAddRuns: () => void;
  onCancelAddRuns: () => void;
  onRunsAdded: () => void;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  canEdit: boolean;
}) {
  return (
    <section className={`runtype${type.active ? '' : ' retired'}`}>
      <div className="runtype-hd">
        <input
          className="cell-input"
          defaultValue={type.name}
          readOnly={!canEdit}
          aria-label={`Name for ${type.name}`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== type.name) void run(type.id, () => updateRunType(type.id, { name: v }));
          }}
        />
        <span className="pill neutral">{type.kind === 'suite' ? 'Suite' : 'Standard'}</span>
        <label className="rate-inline">
          <span>$</span>
          <input
            className="cell-input narrow"
            defaultValue={(type.rateCents / 100).toFixed(2)}
            readOnly={!canEdit}
            inputMode="decimal"
            aria-label={`Nightly rate for ${type.name}`}
            onBlur={(e) => {
              const cents = toCents(e.target.value);
              if (cents !== null && cents !== type.rateCents) {
                void run(type.id, () => updateRunType(type.id, { rateCents: cents }));
              }
            }}
          />
          <em>/ night</em>
        </label>
        <span className="runtype-count">
          {type.activeRunCount} of {type.runCount} active
        </span>
        {!type.active && <span className="pill warn">Retired</span>}
        {canEdit && <div className="runtype-actions">
          {!addingRuns && type.active && (
            <button className="btn ghost" onClick={onAddRuns}>
              <Icon name="plus" size={14} />
              Add runs
            </button>
          )}
          {type.active ? (
            <button
              className="btn ghost"
              disabled={busy === type.id}
              onClick={() => void run(type.id, () => updateRunType(type.id, { active: false }))}
            >
              Retire
            </button>
          ) : (
            <button
              className="btn ghost"
              disabled={busy === type.id}
              onClick={() => void run(type.id, () => updateRunType(type.id, { active: true }))}
            >
              Restore
            </button>
          )}
          {type.runCount === 0 && (
            <button
              className="btn ghost danger"
              disabled={busy === type.id}
              onClick={() => {
                if (window.confirm(`Delete the "${type.name}" run type?`)) {
                  void run(type.id, () => deleteRunType(type.id));
                }
              }}
            >
              Delete
            </button>
          )}
        </div>}
      </div>

      {addingRuns && (
        <AddRunsForm
          type={type}
          busy={busy === `runs-${type.id}`}
          onCancel={onCancelAddRuns}
          onSubmit={async (body) => {
            await run(`runs-${type.id}`, () => createRuns({ runTypeId: type.id, ...body }));
            onRunsAdded();
          }}
        />
      )}

      {type.runs.length === 0 ? (
        <p className="setting-note plain">No runs in this type yet.</p>
      ) : (
        <div className="rungrid">
          {type.runs.map((r) => (
            <RunChip key={r.id} run={r} busy={busy} onAction={run} canEdit={canEdit} />
          ))}
        </div>
      )}
    </section>
  );
}

function RunChip({
  run: r,
  busy,
  onAction,
  canEdit,
}: {
  run: RunSetting;
  busy: string | null;
  onAction: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const working = busy === r.id;

  if (editing) {
    return (
      <div className="runchip editing">
        <input
          className="cell-input narrow"
          defaultValue={r.code}
          aria-label={`Code for ${r.code}`}
          autoFocus
          onBlur={(e) => {
            const v = e.target.value.trim().toUpperCase();
            setEditing(false);
            if (v && v !== r.code) void onAction(r.id, () => updateRun(r.id, { code: v }));
          }}
        />
      </div>
    );
  }

  return (
    <div className={`runchip${r.active ? '' : ' retired'}`}>
      <button
        className="runchip-code"
        onClick={() => canEdit && setEditing(true)}
        title={canEdit ? 'Rename' : r.code}
      >
        {r.code}
      </button>
      {r.capacity > 1 && <em>×{r.capacity}</em>}
      {r.inUse && <span className="runchip-dot" title="A dog is booked in here" />}
      {canEdit && <div className="runchip-menu">
        {r.active ? (
          <button
            disabled={working}
            onClick={() => void onAction(r.id, () => updateRun(r.id, { active: false }))}
            title="Retire this run"
          >
            Retire
          </button>
        ) : (
          <button
            disabled={working}
            onClick={() => void onAction(r.id, () => updateRun(r.id, { active: true }))}
            title="Bring back into service"
          >
            Restore
          </button>
        )}
        {!r.hasHistory && (
          <button
            className="danger"
            disabled={working}
            onClick={() => {
              if (window.confirm(`Delete run ${r.code}?`)) {
                void onAction(r.id, () => deleteRun(r.id));
              }
            }}
            title="Delete permanently"
          >
            Delete
          </button>
        )}
      </div>}
    </div>
  );
}

function AddTypeForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: {
    name: string;
    zoneLabel: string;
    kind: 'suite' | 'run';
    defaultCapacity: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'suite' | 'run'>('run');
  const [capacity, setCapacity] = useState('1');

  return (
    <form
      className="group-add"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          name: name.trim(),
          zoneLabel: name.trim(),
          kind,
          defaultCapacity: Number(capacity),
        });
      }}
    >
      <label className="inline-field">
        <span>Type name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Standard runs · D wing"
          autoFocus
        />
      </label>
      <label className="inline-field" style={{ maxWidth: 150 }}>
        <span>Class</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'suite' | 'run')}>
          <option value="run">Standard run</option>
          <option value="suite">Suite</option>
        </select>
      </label>
      <label className="inline-field" style={{ maxWidth: 120 }}>
        <span>Dogs per run</span>
        <input
          type="number"
          min={1}
          max={20}
          value={capacity}
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </label>
      <div className="group-add-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add type'}
        </button>
      </div>
    </form>
  );
}

function AddRunsForm({
  type,
  busy,
  onCancel,
  onSubmit,
}: {
  type: RunTypeSetting;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: { code: string; count: number; capacity: number }) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [count, setCount] = useState('1');
  const [capacity, setCapacity] = useState(String(type.defaultCapacity));
  const n = Number(count);

  return (
    <form
      className="group-add"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ code: code.trim(), count: n, capacity: Number(capacity) });
      }}
    >
      <label className="inline-field" style={{ maxWidth: 150 }}>
        <span>Starting code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="D1"
          autoFocus
        />
      </label>
      <label className="inline-field" style={{ maxWidth: 120 }}>
        <span>How many</span>
        <input
          type="number"
          min={1}
          max={60}
          value={count}
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) => setCount(e.target.value)}
        />
      </label>
      <label className="inline-field" style={{ maxWidth: 120 }}>
        <span>Dogs per run</span>
        <input
          type="number"
          min={1}
          max={20}
          value={capacity}
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) => setCapacity(e.target.value)}
        />
      </label>
      <p className="field-note wide">
        {n > 1 && code.trim()
          ? `Creates ${n} runs numbered from ${code.trim().toUpperCase()}.`
          : 'Numbering continues from the starting code, so a whole wing is one action.'}
      </p>
      <div className="group-add-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Adding…' : n > 1 ? `Add ${n} runs` : 'Add run'}
        </button>
      </div>
    </form>
  );
}
