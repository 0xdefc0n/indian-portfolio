// /privacy, /terms and /security (plan §12, M14). Public pages in the app's own design (§13): the bento Panel,
// the existing tokens, readable at 360 px. Plain, calm wording (owner, 2026-11-26); every promise here is one the
// code keeps (see the comments next to each claim).
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
            Draft. This text hasn't had its legal review yet.
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
  <a href={`mailto:${to}`} className="text-primary underline-offset-4 hover:underline">{to}</a>
)

function Contact() {
  return (
    <p>
      Questions, requests or complaints: write to <Mail to={LEGAL.contactEmail} />. We reply within {LEGAL.replyWithin},
      usually much sooner.
    </p>
  )
}

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="Your family's money is personal. Here's exactly what PocketFolio keeps, why, and how it stays yours, in line with India's Digital Personal Data Protection Act, 2023."
    >
      <Section title="What we keep">
        <ul>
          <li><b>Your account:</b> your email address, and your name and picture if you sign in with Google.</li>
          <li><b>From the statements you add:</b> your family members' names, their folios, holdings, transactions and SIPs.</li>
          <li><b>The SIP changes you tell us about:</b> a skipped instalment or a cancelled SIP.</li>
          <li>
            <b>Sign-in details:</b> which device, browser and network address each sign-in came from, so you can spot a
            sign-in that wasn't you.
          </li>
          <li>
            <b>A security log</b> of account events (like "statement added") with the date and country. It never holds
            names or amounts.
          </li>
        </ul>
        <p>
          A statement also contains each member's PAN. We keep it encrypted, use it only to file each statement under the
          right person and to open their next statement for you, and only ever show it masked, like AB••••••4F.
        </p>
      </Section>

      <Section title="Why">
        <p>
          Only to show you your family's portfolio and how it's doing: values at the latest NAVs, returns, SIPs, capital
          gains and the stocks inside your funds. We never sell your data, show you ads or share it for marketing.
        </p>
      </Section>

      <Section title="Your statement PDFs">
        <p>{PDF_HANDLING}</p>
        <p>A statement's password is used only to open it and isn't kept after that.</p>
      </Section>

      <Section title="How it's protected">
        <p>
          Everything we keep about your family is locked with bank-grade AES-256 encryption, under a private key made
          just for your family. Without that key the data is unreadable, even to someone holding a copy of our database.
        </p>
        <p>
          Your data is only ever unlocked automatically, to build your dashboard. Nobody at PocketFolio looks at your
          portfolio: there's no screen or tool for it, and our logs never contain it. See{" "}
          <Link href="/security" className="text-primary underline-offset-4 hover:underline">Security</Link> for more.
        </p>
      </Section>

      <Section title="How long we keep it">
        <ul>
          <li>For as long as you have an account, until you delete a statement, a member or the whole account.</li>
          <li>
            Deleting your account erases everything at once, and destroys your family's key, so it can never be read
            again.
          </li>
          <li>
            If nobody signs in for {INACTIVE_PERIOD}, we email you, and 2 days later we delete the account unless you
            sign in.
          </li>
          <li>The security log is kept for a little over a year, as the law requires, then deleted.</li>
        </ul>
      </Section>

      <Section title="Your rights">
        <ul>
          <li><b>See your data:</b> Settings → Download my data gives you everything we hold about you.</li>
          <li><b>Correct it:</b> add a newer statement, rename a member, or delete a statement.</li>
          <li><b>Erase it:</b> delete a member in Members, or your whole account in Settings.</li>
          <li><b>Withdraw consent:</b> delete your account in Settings. We stop at once.</li>
          <li><b>Nominate someone</b> to act for you if you can't: write to us.</li>
          <li><b>Complain:</b> write to us first. You can also reach the Data Protection Board of India.</li>
        </ul>
      </Section>

      <Section title="Family members and children">
        <p>
          You must be 18 or older to use PocketFolio. You can add statements for family members, including children,
          when you manage their investments or they've agreed. For a child, the parent or guardian who adds them is the
          user.
        </p>
      </Section>

      <Section title="Contact">
        <Contact />
        <p>If we change this policy in a way that matters, we'll ask you to agree again the next time you open the app.</p>
      </Section>
    </LegalPage>
  )
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of use" intro="The simple agreement for using PocketFolio.">
      <Section title="Not investment advice">
        <p className="font-medium">{NOT_ADVICE}</p>
        <p>
          PocketFolio reads your statements and shows figures and analytics about them. Nothing in it, including tax and
          capital-gains figures, is investment, tax or legal advice, or a recommendation to buy, sell or hold anything.
          We aren't a SEBI-registered investment adviser. For decisions, talk to a qualified adviser.
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
          <li>SIP instalments after your last statement are estimates, until a newer statement shows the real ones.</li>
          <li>
            We work hard to get every figure right, but one can occasionally be wrong or late. Your fund house's and
            depository's statements are the official record.
          </li>
        </ul>
      </Section>

      <Section title="Fair use">
        <p>
          There are sensible limits on uploads, members and downloads, to keep PocketFolio fast for everyone. Please don't
          try to get around them, access other people's accounts, or overload the service.
        </p>
      </Section>

      <Section title="The service">
        <p>
          PocketFolio is free. We may improve or change features over time, and we'll give notice before ever closing the
          service. You can download your data and delete your account at any time.
        </p>
        <p>
          As far as the law allows, we aren't liable for decisions made using PocketFolio, or for indirect losses. Nothing
          here limits your rights under Indian consumer law.
        </p>
      </Section>

      <Section title="Law and questions">
        <p>These terms are governed by the laws of India. If anything goes wrong, write to us first: most things are quick to fix.</p>
        <Contact />
      </Section>
    </LegalPage>
  )
}

export function SecurityPage() {
  return (
    <LegalPage title="Security" intro="How PocketFolio keeps your family's data safe.">
      <Section title="Bank-grade encryption">
        <ul>
          <li>
            Your statements, members' names and PANs, and your dashboard are encrypted with AES-256, the standard banks
            use, under a private key made just for your family.
          </li>
          <li>
            That key is itself locked by a master key kept separately from the data, so a copy of our database or storage
            on its own is unreadable.
          </li>
          <li>Each encrypted item is tied to your account, so it can never be read as part of anyone else's.</li>
          <li>Everything between your device and PocketFolio travels over HTTPS.</li>
        </ul>
      </Section>
      <Section title="Your PDFs">
        <p>{PDF_HANDLING}</p>
      </Section>
      <Section title="Only you get in">
        <ul>
          <li>No password to steal: you sign in with Google, or a one-time link or code sent to your email.</li>
          <li>Every request is checked against your account, so nobody can see another family's data.</li>
          <li>Downloading your data or deleting your account.</li>
        </ul>
      </Section>
      <Section title="Delete anytime, for good">
        <p>
          When you delete your account we destroy your family's key first, so nothing of yours can ever be read again,
          then delete the data itself permanently.
        </p>
      </Section>
      <Section title="We'll always tell you">
        <p>
          If something ever affected your data, we'd tell you straight away: what happened, what it means for you, and what
          we're doing about it.
        </p>
        <p>
          Spotted a security issue? Write to <Mail to={LEGAL.contactEmail} /> with "Security" in the subject.
        </p>
      </Section>
    </LegalPage>
  )
}
