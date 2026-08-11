import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';

const REPORTS: Array<{
  to: string;
  title: string;
  icon: IconName;
  what: string;
  when: string;
}> = [
  {
    to: '/reports/care-log',
    title: 'Daily care log',
    icon: 'care',
    what: 'Every dose and meal for one day, who gave it and when, and anything that was missed.',
    when: 'The record you reach for when an owner asks what happened.',
  },
  {
    to: '/reports/occupancy',
    title: 'Occupancy',
    icon: 'board',
    what: 'Runs filled each night and dogs in daycare each day, against what the building holds.',
    when: 'Deciding whether to take another booking, or whether to open another wing.',
  },
  {
    to: '/reports/revenue',
    title: 'Revenue',
    icon: 'dashboard',
    what: 'Invoices raised in a period, split by what was sold and how it was paid, plus what is still owed.',
    when: 'Month end, and any time the outstanding column needs chasing.',
  },
  {
    to: '/reports/vaccinations',
    title: 'Vaccinations',
    icon: 'clients',
    what: 'Everything expired or expiring, with owner contact details and whether a stay is already booked.',
    when: 'Working through paperwork before it turns into a doorstep argument.',
  },
];

export function Reports() {
  return (
    <>
      <div className="topbar">
        <h1>Reports</h1>
        <span className="date">Everything is printable and exports to CSV</span>
      </div>
      <div className="content">
        <div className="report-grid">
          {REPORTS.map((r) => (
            <Link key={r.to} to={r.to} className="report-card">
              <span className="report-icon">
                <Icon name={r.icon} size={18} />
              </span>
              <b>{r.title}</b>
              <p>{r.what}</p>
              <small>{r.when}</small>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
