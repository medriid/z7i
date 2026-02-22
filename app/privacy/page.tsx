import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy policy for the Z7I-Scraper for JEE prep — what data we collect, how we use it, and your rights.',
  alternates: {
    canonical: '/privacy',
  },
};

export default function PrivacyPolicyPage() {
  return (
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', lineHeight: 1.7, backgroundColor: '#080b12', color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', minHeight: '100vh' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>Privacy Policy</h1>
          <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 32 }}>Last updated: February 13, 2026</p>

          <p>
            Z7I (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;the platform&rdquo;) is a personal, non-commercial test
            preparation tool that helps students analyze their JEE test performance, practice past-year questions (PYQs),
            and study more effectively. This Privacy Policy explains what data we collect, why we collect it, and how it is handled.
          </p>

          <Section title="1. Information We Collect">
            <Subsection title="Account Information">
              <p>
                When you register, we collect your <strong>email address</strong> and a <strong>hashed password</strong>.
                You may optionally provide a display name and profile image.
              </p>
            </Subsection>
            <Subsection title="Z7I Platform Credentials">
              <p>
                To sync your test data, you may link your Z7I (third-party) account by providing your enrollment number
                and password. Your Z7I password is stored in encrypted form and is only used to fetch your test data
                from the Z7I platform on your behalf.
              </p>
            </Subsection>
            <Subsection title="Test &amp; Academic Data">
              <p>
                We store test attempts, scores, question-level responses, and PYQ practice history to provide analytics
                and track your progress over time.
              </p>
            </Subsection>
            <Subsection title="Usage Data">
              <p>
                We log your <strong>IP address</strong> for security and abuse-prevention purposes. We do not use
                third-party analytics trackers or advertising SDKs.
              </p>
            </Subsection>
            <Subsection title="AI Chat Data">
              <p>
                If you use the AI doubt-solving or chat features, your messages and AI responses are stored to maintain
                conversation history. Messages may be sent to third-party AI model providers (e.g., Google Gemini) to
                generate responses.
              </p>
            </Subsection>
          </Section>

          <Section title="2. How We Use Your Data">
            <ul style={{ paddingLeft: 20 }}>
              <li>Authenticate you and maintain your session.</li>
              <li>Sync, display, and analyze your test performance.</li>
              <li>Track PYQ practice progress and league/EXP standings.</li>
              <li>Provide AI-powered doubt solving and study assistance.</li>
              <li>Prevent abuse, enforce rate limits, and ensure platform security.</li>
            </ul>
          </Section>

          <Section title="3. Data Sharing">
            <p>
              We do not sell, rent, or share your personal data with any third party for marketing purposes. Data may be
              shared only in these limited circumstances:
            </p>
            <ul style={{ paddingLeft: 20 }}>
              <li><strong>AI Providers:</strong> Chat messages are sent to AI model providers to generate responses. These providers process data per their own privacy policies.</li>
              <li><strong>Leaderboard:</strong> If you participate in the league system, your display name and EXP rank may be visible to other users. You can opt out by marking yourself as unranked.</li>
              <li><strong>Legal:</strong> We may disclose data if required to comply with applicable law.</li>
            </ul>
          </Section>

          <Section title="4. Data Storage &amp; Security">
            <p>
              Data is stored in a PostgreSQL database hosted on secure infrastructure. Passwords are hashed with bcrypt.
              Third-party credentials are encrypted at rest. Sessions are token-based with expiration. All traffic is
              served over HTTPS.
            </p>
          </Section>

          <Section title="5. Cookies &amp; Local Storage">
            <p>
              We use browser <strong>localStorage</strong> to persist your authentication token, theme preferences, and
              cached application state. We do not use tracking cookies or third-party cookie-based analytics.
            </p>
          </Section>

          <Section title="6. Data Retention">
            <p>
              Your data is retained for as long as your account exists. If you wish to have your account and associated
              data deleted, you may contact us and we will remove it within a reasonable timeframe.
            </p>
          </Section>

          <Section title="7. Children&rsquo;s Privacy">
            <p>
              Z7I is intended for JEE aspirants, who are typically 15 years of age or older. We do not knowingly collect
              data from children under 13 years of age.
            </p>
          </Section>

          <Section title="8. Your Rights">
            <p>
              You may request access to, correction of, or deletion of your personal data at any time by reaching out to
              us. You can unlink your Z7I account and delete your chat history from within the platform.
            </p>
          </Section>

          <Section title="9. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. The &ldquo;Last updated&rdquo; date at the top of this
              page reflects the most recent revision.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>
              If you have questions about this Privacy Policy, you may reach out via the platform or by opening an issue
              on my <a href="https://github.com/medriid/z7i" style={{ color: '#60a5fa', textDecoration: 'underline' }}>GitHub repository</a>.
            </p>
          </Section>

          <p style={{ marginTop: 48, fontSize: 13, color: '#64748b', borderTop: '1px solid #1e293b', paddingTop: 24 }}>
            &copy; {new Date().getFullYear()} Z7I. This is a personal, non-commercial project, meant for my friends.
          </p>
        </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: '#f1f5f9', marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ fontSize: 16, fontWeight: 500, color: '#cbd5e1', marginBottom: 4 }}>{title}</h3>
      {children}
    </div>
  );
}
