// /privacy, /terms and /security (plan §12, M14). Public pages in the app's own design (§13): the bento Panel,
// the existing tokens, readable at 360 px. The bracketed legal details are placeholders until the owner provides
// them (lib/legal.ts); a banner says so. A lawyer reviews these texts before launch (M17).
import { Link } from "wouter"

import { Panel } from "@/components/panel"
import { PublicShell } from "@/components/public-shell"
import { INACTIVE_PERIOD, LEGAL, NOT_ADVICE, PDF_HANDLING } from "@/lib/legal"

function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-3 pb-12 sm:px-7 sm:pt-6">
        <div className="pb-2">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-muted-foreground">{intro}</p>
          <p className="mt-1 text-sm text-muted-foreground">Effective {LEGAL.effective}.</p>
        </div>
        {LEGAL.placeholders && (
          <p className="rounded-xl bg-surface-2 p-3 text-sm ring-1 ring-border" role="note">
            Draft. The details in [brackets] are still to be filled in, and this text hasn't had its legal review yet.
          </p>
        )}
        {children}
        <nav aria-label="Other policies" className="flex flex-wrap gap-x-4 pt-2 text-sm">
          <Link href="/privacy" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">Privacy policy</Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">Terms of use</Link>
          <Link href="/security" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">Security</Link>
        </nav>
      </main>
    </PublicShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel title={title}>
      <div className="space-y-3 text-sm leading-relaxed [&_li]:ml-4 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">{children}</div>
    </Panel>
  )
}

const Mail = ({ to }: { to: string }) => (
  <a href={`mailto:${to.replace(/[[\]]/g, "")}`} className="text-primary underline-offset-4 hover:underline">{to}</a>
)

export function Grievance() {
  return (
    <p>
      Grievance officer: {LEGAL.grievanceOfficer}, {LEGAL.entity}. Email <Mail to={LEGAL.grievanceEmail} />. For anything
      else, <Mail to={LEGAL.supportEmail} />. We answer within 90 days, usually much sooner.
    </p>
  )
}

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={`How PocketFolio, run by ${LEGAL.entity}, handles your personal data, under India's Digital Personal Data Protection Act, 2023 and its Rules.`}
    >
      <Section title="What we collect">
        <ul>
          <li><b>Your account:</b> your email address, and your name and picture if you sign in with Google.</li>
          <li>
            <b>From the statements you upload:</b> each family member's name and PAN, their folios, holdings, transactions
            and SIPs.
          </li>
          <li><b>The SIP changes you tell us about:</b> a skipped instalment or a cancelled SIP.</li>
          <li>
            <b>Sign-in sessions:</b> for each device you're signed in on, the IP address and browser (user agent) it signed
            in from, and when. You see them in your data export.
          </li>
          <li>
            <b>A security log:</b> what happened (for example "statement added"), when, and the country of the request. It
            holds no names, PANs or amounts.
          </li>
        </ul>
        <p>We don't use advertising or analytics trackers. The only cookies are the ones that keep you signed in.</p>
      </Section>

      <Section title="Why">
        <p>
          Only to show you your family's portfolio and its analytics: values at the latest NAVs, returns, SIPs, capital
          gains and the stocks inside your funds. We don't sell your data, share it for marketing, or use it for anything
          else.
        </p>
      </Section>

      <Section title="Your statement PDFs">
        <p>{PDF_HANDLING}</p>
        <p>
          A statement's password is used once, to open it, and isn't kept. If your upload waits in a queue, the password
          you typed is held encrypted with the PDF and deleted with it.
        </p>
      </Section>

      <Section title="How it's protected">
        <p>
          Everything we keep about your family is encrypted with a key of its own, which only your account uses. See{" "}
          <Link href="/security" className="text-primary underline-offset-4 hover:underline">Security</Link> for the details.
        </p>
      </Section>

      <Section title="Who else handles it">
        <ul>
          <li>
            <b>Cloudflare</b> runs PocketFolio and stores its data (encrypted). Its data centres may be outside India.
          </li>
          <li><b>Google</b>, if you choose "Continue with Google", tells us your email, name and picture.</li>
          <li>
            Public market data (fund NAVs, holiday calendars, the stocks inside funds) comes from AMFI and other public
            sources. We only send them fund names and codes, never anything about you.
          </li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <ul>
          <li>Your data stays while you have an account, until you delete a statement, a member or the whole account.</li>
          <li>
            Deleting your account erases everything at once, and the key that encrypted it. Copies in our database backups
            can't be read without that key and are purged within 30 days.
          </li>
          <li>
            If nobody signs in to an account for {INACTIVE_PERIOD}, we email you, and 2 days later we delete the account
            unless you sign in.
          </li>
          <li>The security log is kept for a little over a year, as the law requires, then deleted.</li>
          <li>Queued PDFs: always deleted within 24 hours (see above).</li>
        </ul>
      </Section>

      <Section title="Your rights">
        <ul>
          <li><b>See your data:</b> Settings → Download my data gives you everything we hold about you, decrypted.</li>
          <li><b>Correct it:</b> upload a newer statement, rename a member, or delete a statement.</li>
          <li><b>Erase it:</b> delete a member in Members, or your whole account in Settings.</li>
          <li><b>Withdraw consent:</b> delete your account in Settings. We stop processing at once.</li>
          <li>
            <b>Nominate someone</b> to act for you if you die or can't: email the grievance officer.
          </li>
          <li>
            <b>Complain:</b> to our grievance officer first (below). If you're not satisfied, you can complain to the Data
            Protection Board of India.
          </li>
        </ul>
      </Section>

      <Section title="Family members and children">
        <p>
          You must be 18 or older to use PocketFolio. You can add statements for family members, including children,
          when you're entitled to manage their investments or they've agreed. For a child, the parent or guardian who
          adds them is the user.
        </p>
      </Section>

      <Section title="Contact">
        <Grievance />
        <p>
          If we change this policy in a way that matters, we'll ask you to agree again the next time you open the app.
        </p>
      </Section>
    </LegalPage>
  )
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of use" intro={`The agreement between you and ${LEGAL.entity} for using PocketFolio.`}>
      <Section title="Not investment advice">
        <p className="font-medium">{NOT_ADVICE}</p>
        <p>
          PocketFolio reads your statements and shows figures and analytics about them. Nothing in it, including tax,
          capital-gains and health-check figures, is investment, tax or legal advice, or a recommendation to buy, sell or
          hold anything. We aren't a SEBI-registered investment adviser or research analyst. Talk to a qualified adviser
          before you decide.
        </p>
      </Section>

      <Section title="Who can use it">
        <p>
          You must be 18 or older. One account is for one person, who can add their family's statements. Only add a
          statement you're entitled to: your own, or a family member's when you manage their investments or they've
          agreed.
        </p>
      </Section>

      <Section title="What the figures are">
        <ul>
          <li>Values come from your statements and the latest NAVs published by AMFI and fund houses.</li>
          <li>
            Instalments after your last statement are estimates, until a newer statement shows what really happened.
          </li>
          <li>
            We work hard to get them right, but they can be wrong or late. Your fund house's and depository's statements are
            the official record.
          </li>
        </ul>
      </Section>

      <Section title="Fair use">
        <p>
          The app has limits on uploads, members and downloads to keep it fast for everyone. Don't
          try to get around them, break into other accounts, or overload the service. We may suspend an account that does.
        </p>
      </Section>

      <Section title="The service">
        <p>
          PocketFolio is free and provided as it is. We may change features, or stop the service with notice. You can
          download your data and delete your account at any time.
        </p>
        <p>
          As far as the law allows, we aren't liable for losses from decisions made using PocketFolio, or for indirect
          losses. Nothing here limits rights you have under Indian consumer law.
        </p>
      </Section>

      <Section title="Law and disputes">
        <p>
          These terms are governed by the laws of India. The courts of {LEGAL.jurisdiction} have jurisdiction. Please write
          to us first: most problems are quicker to fix that way.
        </p>
        <Grievance />
      </Section>
    </LegalPage>
  )
}

export function SecurityPage() {
  return (
    <LegalPage title="Security" intro="How PocketFolio protects your family's data, in short.">
      <Section title="Encryption">
        <ul>
          <li>
            Your statements' contents, members' names and PANs, and your dashboard are encrypted with AES-256-GCM, using a
            key that belongs to your account alone. That key is itself encrypted with a master key held apart from the data.
          </li>
          <li>
            Each encrypted item is tied to your account, so it can't be moved into anyone else's. A copy of our database or
            storage on its own is unreadable.
          </li>
          <li>Everything travels over HTTPS.</li>
        </ul>
      </Section>
      <Section title="Your PDFs">
        <p>{PDF_HANDLING}</p>
      </Section>
      <Section title="Access">
        <ul>
          <li>No passwords to steal: you sign in with Google, or a one-time link or code sent to your email.</li>
          <li>Every request is checked against your account, so nobody can see another family's data.</li>
          <li>
            Downloading your data and deleting your account always re-check your session. Deleting needs a sign-in from
            the last 10 minutes.
          </li>
          <li>Our logs never contain names, PANs, emails, folios or amounts.</li>
        </ul>
      </Section>
      <Section title="Deleting">
        <p>
          When you delete your account we destroy its key first, so nothing of yours can be read again, then delete the
          data itself. Backups become unreadable at once and are purged within 30 days.
        </p>
      </Section>
      <Section title="If something goes wrong">
        <p>
          If a breach affects your data, we tell you without delay: what happened, what it means for you and what you can
          do. We also report it to the Data Protection Board of India and CERT-In as the law requires.
        </p>
        <p>
          Found a security problem? Email <Mail to={LEGAL.supportEmail} /> with "Security" in the subject. Please don't
          access other people's data while testing.
        </p>
      </Section>
    </LegalPage>
  )
}
