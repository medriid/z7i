import { CalendarDays, History, Sparkles, NotebookTabs, Rocket, CheckCircle2 } from 'lucide-react';

type UpdateItem = { date: string; title: string; features: string[]; releaseNotes?: string[] };

const FIRST_RELEASE_FEATURES = [
  'Z7I account linking + one-click sync flow with progress tracking',
  'Full test ingestion pipeline (packages, tests, questions, responses, rank + percentile metadata)',
  'Test dashboard with score cards, correct/incorrect/unattempted analytics, and rank badge display',
  'Question-wise test review with subject grouping and quick filters',
  'Custom test writer/re-take workflow for targeted revision sessions',
  'Bookmarks system for saving difficult questions and revising later',
  'Manual notes on saved questions for personalized revision context',
  'Share-ready result summaries for quick distribution of test performance',
  'Owner dashboard for data controls, user oversight, and platform operations',
  'Guest sync permission controls managed by owner settings',
  'Monochrome UI theming with configurable dashboard brand name/color + background controls',
  'Authentication base flow (sign-up, sign-in, persistent sessions, protected routes)',
  'Responsive app shell and route-based navigation for all primary study surfaces',
  'Initial release hardening for stable large-account sync behavior',
];

const UPDATES: UpdateItem[] = [
  {
    date: '2026-02-08',
    title: 'v1.0 Foundation Release',
    features: FIRST_RELEASE_FEATURES,
    releaseNotes: [
      'This was the first full public release of the Z7I-powered test system and revision workspace.',
      'Core focus was reliable data sync, complete test analysis coverage, and strong first-session usability.',
      'All launch modules were shipped in monochrome style and tuned for low-distraction exam prep.',
    ],
  },
  { date: '2026-02-09', title: 'PYQ Flow Upgrade', features: ['PYQ chapter overview improvements with resume/filter experiences'] },
  { date: '2026-02-10', title: 'PWA + Exam UX', features: ['PWA support', 'Exam writer and custom test UI upgrades'] },
  { date: '2026-02-12', title: 'Platform Expansion', features: ['Migration to Next.js', 'Zone workspace introduced and expanded', 'AI solution and doubt-solver flow for PYQs', 'League system launch'] },
  { date: '2026-02-13', title: 'Identity + Sync Refinement', features: ['Profile picture/brand UI integration', 'League and sync refinements', 'Server-side IP lookup integration'] },
  { date: '2026-02-14', title: 'Exam Engine Update', features: ['Exam formatting improvements and case-study handling updates'] },
  { date: '2026-02-15', title: 'Communication & AI Release', features: ['Chat system rollout', 'AI PDF-to-test conversion and AI page revamp'] },
  { date: '2026-02-16', title: 'Security Hardening', features: ['Optional email OTP-based 2FA setup'] },
  { date: '2026-02-17', title: 'Social + Recovery Patch', features: ['Password reset OTP flow', 'Grouped chat channels and creator-managed group settings', 'GIF favorites + Giphy chat integration'] },
  { date: '2026-02-18', title: 'Realtime Chat Infrastructure', features: ['Pusher Channels integration replacing polling for live messages, edits, deletes, reactions, and read receipts', 'Redis-backed server-side chat list caching + active chat presence tracking', 'Realtime group metadata refresh and chat stream resiliency improvements'] },
];

export function UpdatesPage() {
  const firstRelease = UPDATES[0];

  return (
    <div className="page">
      <div className="container updates-page-container">
        <header className="updates-hero card updates-fade-in">
          <div>
            <h1 className="page-title"><History size={18} /> Product Updates</h1>
            <p className="page-subtitle">Commit-based changelog for every shipped milestone, in the same monochrome visual language.</p>
          </div>
          <div className="updates-hero-pill">
            <Sparkles size={14} /> {UPDATES.length} Releases
          </div>
        </header>

        {firstRelease && (
          <section className="card updates-release-highlight updates-rise-in">
            <h2><NotebookTabs size={16} /> First Release Notes · {firstRelease.title}</h2>
            <p>{firstRelease.date}</p>
            <ul>
              {firstRelease.releaseNotes?.map(note => <li key={note}>{note}</li>)}
            </ul>

            <div className="updates-launch-panel" aria-label="Launch features inventory">
              <div className="updates-launch-panel-head">
                <h3><Rocket size={15} /> Launch Feature Inventory</h3>
                <span>All major systems shipped in v1.0</span>
              </div>
              <div className="updates-launch-grid">
                {FIRST_RELEASE_FEATURES.map((feature) => (
                  <div key={feature} className="updates-launch-item">
                    <CheckCircle2 size={13} />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="updates-timeline">
          {UPDATES.map((entry, index) => (
            <section key={entry.date} className="card updates-entry" style={{ animationDelay: `${index * 50}ms` }}>
              <div className="updates-entry-line" aria-hidden />
              <div className="updates-entry-dot" aria-hidden />
              <div className="updates-entry-head">
                <h3>{entry.title}</h3>
                <span><CalendarDays size={14} /> {entry.date}</span>
              </div>
              <ul>
                {entry.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
