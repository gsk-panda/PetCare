import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchVaccineAlerts, type VaccineAlertsResponse } from '../api';
import { Icon } from './Icon';

function expiryLabel(daysLeft: number): string {
  if (daysLeft < 0) return `expired ${Math.abs(daysLeft)}d ago`;
  if (daysLeft === 0) return 'expires today';
  return `${daysLeft}d left`;
}

/**
 * Vaccine expiries needing action. Anything expiring mid-stay is promoted to
 * the top and called out separately: those pets pass the check-in check and
 * then quietly fall out of compliance while boarded.
 */
export function VaccineAlerts({ withinDays = 30 }: { withinDays?: number }) {
  const [data, setData] = useState<VaccineAlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetchVaccineAlerts(withinDays)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [withinDays]);

  if (error) return <div className="hint error">Vaccine alerts unavailable: {error}</div>;
  if (!data) return null;

  const duringStay = data.alerts.filter((a) => a.expiresDuringStay);
  const others = data.alerts.filter((a) => !a.expiresDuringStay);

  return (
    <>
      {duringStay.length > 0 && !dismissed && (
        <div className="alert-banner" role="alert">
          <div>
            <b>
              {duringStay.length} vaccine{duringStay.length === 1 ? '' : 's'} will expire during a
              booked stay
            </b>
            <small>
              {duringStay
                .slice(0, 3)
                .map((a) => `${a.petName} · ${a.vaccine} on ${a.expiresOn}`)
                .join(' · ')}
              {duringStay.length > 3 ? ` · +${duringStay.length - 3} more` : ''}
            </small>
          </div>
          <button className="alert-x" onClick={() => setDismissed(true)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="card">
        <div className="hd">
          <b>Vaccines expiring</b>
          <span className="cnt">{data.summary.total}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--p-ink-soft)' }}>
            next {withinDays} days
          </span>
        </div>
        {data.alerts.length === 0 ? (
          <div className="hint">Everything current for the next {withinDays} days.</div>
        ) : (
          <ul className="alist">
            {[...duringStay, ...others].slice(0, 8).map((a) => (
              <li key={a.id}>
                <span
                  className={`dot ${a.expired ? 'bad' : a.expiresDuringStay ? 'bad' : 'warn'}`}
                />
                <span>
                  <b>
                    <Link to={`/pets/${a.petId}`} className="linkish">
                      {a.petName}
                    </Link>{' '}
                    · {a.vaccine}
                  </b>
                  <small>
                    {expiryLabel(a.daysLeft)} ({a.expiresOn}) · {a.clientName}
                    {a.clientPhone ? ` · ${a.clientPhone}` : ''}
                  </small>
                  {a.expiresDuringStay && a.stay && (
                    <small style={{ color: 'var(--p-bad)', fontWeight: 700 }}>
                      Expires mid-stay ({a.stay.startDate} → {a.stay.endDate}
                      {a.stay.runCode ? `, ${a.stay.runCode}` : ''})
                    </small>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
