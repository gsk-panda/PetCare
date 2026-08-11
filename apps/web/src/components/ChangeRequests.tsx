import { useCallback, useEffect, useState } from 'react';
import {
  createChangeRequest,
  deleteChangeRequest,
  fetchChangeRequests,
  updateChangeRequest,
  type ChangeRequest,
  type ChangeRequestKind,
} from '../api';
import { Icon } from './Icon';

const KINDS: Array<[ChangeRequestKind, string]> = [
  ['add', 'Add'],
  ['change', 'Change'],
  ['remove', 'Remove'],
];

const KIND_PILL: Record<ChangeRequestKind, string> = {
  add: 'good',
  change: 'warn',
  remove: 'bad',
};

function ago(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The facility's own list of what this software should do differently.
 *
 * Deliberately free text with a verb attached rather than a form: the point is
 * to catch a thought at the desk before it evaporates, and anything that makes
 * that slower means it does not get written down at all.
 */
export function ChangeRequests({
  onError,
  canEdit,
}: {
  onError: (msg: string | null) => void;
  canEdit: boolean;
}) {
  const [requests, setRequests] = useState<ChangeRequest[] | null>(null);
  const [kind, setKind] = useState<ChangeRequestKind>('add');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() => {
    fetchChangeRequests()
      .then((r) => setRequests(r.requests))
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

  if (!requests) {
    return (
      <div className="card">
        <div className="hint">Loading the list…</div>
      </div>
    );
  }

  const open = requests.filter((r) => !r.done);
  const done = requests.filter((r) => r.done);
  const shown = showDone ? done : open;

  return (
    <div className="card">
      <div className="hd">
        <b>What this software should do</b>
        <span className="cnt">{open.length} open</span>
        {done.length > 0 && (
          <label className="toggle" style={{ marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            <span>Show the {done.length} done</span>
          </label>
        )}
      </div>

      <p className="setting-note">
        Anything you want added, changed or taken out. Write it the way you would say it —
        this is a notepad, not a ticket system, and it stays with your facility.
      </p>

      {canEdit && (
        <form
          className="cr-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            void run('new', async () => {
              await createChangeRequest({ kind, body: body.trim() });
              setBody('');
              setKind('add');
            });
          }}
        >
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Grooming appointments should show on the board alongside boarding…"
          />
          <div className="cr-add-row">
            <div className="segmented small cr-kind">
              {KINDS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={kind === value ? 'on' : ''}
                  onClick={() => setKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="btn" type="submit" disabled={busy === 'new' || !body.trim()}>
              <Icon name="plus" size={15} />
              Add to the list
            </button>
          </div>
        </form>
      )}

      {shown.length === 0 ? (
        <div className="hint">
          {showDone ? 'Nothing marked done yet.' : 'Nothing on the list. Add the first thing.'}
        </div>
      ) : (
        <ul className="cr-list">
          {shown.map((r) => (
            <li key={r.id} className={r.done ? 'done' : undefined}>
              <span className={`pill ${KIND_PILL[r.kind]}`}>
                {KINDS.find(([k]) => k === r.kind)?.[1]}
              </span>

              {editing === r.id ? (
                <div className="cr-edit">
                  <textarea
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                  />
                  <div className="cr-edit-actions">
                    <button className="btn ghost" type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={busy === r.id || !draft.trim()}
                      onClick={() =>
                        void run(r.id, async () => {
                          await updateChangeRequest(r.id, { body: draft.trim() });
                          setEditing(null);
                        })
                      }
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cr-body">
                  <p>{r.body}</p>
                  <small>
                    {r.createdByName ?? 'Someone'} · {ago(r.createdAt)}
                    {r.updatedByName && r.updatedAt !== r.createdAt && (
                      <> · edited by {r.updatedByName}</>
                    )}
                  </small>
                </div>
              )}

              {canEdit && editing !== r.id && (
                <div className="cr-actions">
                  <button
                    className="btn ghost"
                    disabled={busy === r.id}
                    onClick={() => void run(r.id, () => updateChangeRequest(r.id, { done: !r.done }))}
                  >
                    {r.done ? 'Reopen' : 'Done'}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setEditing(r.id);
                      setDraft(r.body);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy === r.id}
                    onClick={() => {
                      // Deleting is the one action here that loses something,
                      // and the note may be the only record of the idea.
                      if (!window.confirm('Delete this note? It is not kept anywhere else.')) return;
                      void run(r.id, () => deleteChangeRequest(r.id));
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
