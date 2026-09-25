import Link from "next/link";
import type { ReactNode } from "react";
import { RunnerLogo } from "@/components/RunnerLogo";

const SECTIONS = [
  { id: "signing-in", title: "Signing in" },
  { id: "strava-garmin", title: "Strava and Garmin" },
  { id: "how-coach-works", title: "How the coach works" },
  { id: "athlete-profile", title: "Your athlete profile" },
  { id: "briefs-and-plans", title: "Briefs and training plans" },
  { id: "honest-gaps", title: "What this app still doesn’t do" },
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="bit-card scroll-mt-6 bg-base-100 p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold text-base-content">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-base-content/85">
        {children}
      </div>
    </section>
  );
}

export function HelpGuide() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <RunnerLogo className="size-9 shrink-0 text-primary sm:size-10" />
          <h1 className="font-pixel text-base text-primary sm:text-xl">
            Turnova help
          </h1>
        </div>
        <Link href="/" className="bit-btn btn btn-sm btn-outline">
          Back to coach
        </Link>
      </header>

      <p className="text-base leading-relaxed text-base-content/85">
        Turnova is a private running coach in your browser. This guide is for
        new and returning athletes: how to get in, how to feed the coach your
        training life, and how the week on screen actually works.
      </p>

      <nav
        aria-label="On this page"
        className="bit-box bg-base-200 px-4 py-3"
      >
        <p className="font-pixel text-[10px] text-primary">On this page</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="bit-badge badge badge-sm badge-outline"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="signing-in" title="Signing in">
        <p>
          This is a private coach, not a public sign-up. Someone gives you the
          app password. On the login screen, type it and tap Sign in.
        </p>
        <p>
          There is no email account and no “Forgot password.” Turnova does not
          send reset links. If the password fails, ask the person who invited
          you for the current one.
        </p>
        <p>When you are done, open Menu and tap Log out.</p>
      </Section>

      <Section id="strava-garmin" title="Strava and Garmin">
        <p>
          The coach is much sharper once it can see your runs and how recovered
          you are. Header chips show the last Strava and Garmin sync. Tap{" "}
          <strong className="font-semibold text-base-content">Sync</strong> to
          pull both in one go. Connect, disconnect, and Strava Auto-backfill
          still live under Menu.
        </p>
        <p>
          <strong className="font-semibold text-base-content">Strava.</strong>{" "}
          Open Menu and tap Connect Strava. Approve access in the Strava
          window. Then tap Sync in the header, or Auto-backfill in Menu until
          the Strava chip looks ready. The first history load can pause; wait
          a bit and tap again. Tag the shoe you wore on Strava if you want the
          coach to know which pair was on a given run. There is no Disconnect
          button in the app yet.
        </p>
        <p>
          <strong className="font-semibold text-base-content">Garmin.</strong>{" "}
          Open Menu and tap Connect Garmin. Your email and password go to
          Garmin only; Turnova keeps a session, not the password. If Garmin
          asks for a code, enter it. Header Sync (or Menu Sync Garmin) pulls
          recent recovery — sleep, overnight HRV, resting heart rate — and the
          shoes in your Garmin locker. Garmin sometimes blocks the connection
          from this website. Wait and try again, or ask Dan.
        </p>
      </Section>

      <Section id="how-coach-works" title="How the coach works">
        <p>Every answer is built from three ingredients:</p>
        <p>
          <strong className="font-semibold text-base-content">You.</strong> The
          athlete profile — who you are, what you are racing, how you like to
          train, your zones and history.
        </p>
        <p>
          <strong className="font-semibold text-base-content">Your data.</strong>{" "}
          Recent Strava runs, Garmin recovery, and the local weather for the
          home location in your profile.
        </p>
        <p>
          <strong className="font-semibold text-base-content">
            The training philosophy.
          </strong>{" "}
          Turnova coaches experienced runners with a Norwegian threshold
          approach: a lot of truly easy running, controlled work near
          threshold, and recovery as a gate — not a suggestion. The Training
          philosophy line in your profile personalizes that. It does not replace
          it.
        </p>
        <p>
          Chat replies in plain speech, like a coach on the phone. It will not
          invent metrics that are not in the feed. If sleep or HRV did not come
          in, it will say so instead of guessing. Above the composer, tap
          How was my last run? or How has my recent sleep been? to send that
          question without typing.
        </p>
      </Section>

      <Section id="athlete-profile" title="Your athlete profile">
        <p>
          Open Menu → Athlete profile. This is the coach’s picture of you. Save
          before you close. Empty sections mean a quieter, more generic coach.
        </p>
        <p>
          <strong className="font-semibold text-base-content">Identity.</strong>{" "}
          Name, age, and home location (that location drives the weather on
          your week). Training philosophy is that idea in your own words.
        </p>
        <p>
          <strong className="font-semibold text-base-content">Goals.</strong>{" "}
          Distance focus is the racing you care about this season — 5k, 10K,
          half, marathon; pick as many as fit. Short season aims sit under
          that, one line each. These sit beside the races, not instead of them.
        </p>
        <p>
          <strong className="font-semibold text-base-content">Goal races.</strong>{" "}
          Upcoming races the season is built around. Star the A-race. Add a
          date, distance, place, and goal time. Use Search to find a listed
          event, or type one yourself if it is not in the catalog. Notes are
          for course, constraints, and decisions from coaching chats.
        </p>
        <p>
          <strong className="font-semibold text-base-content">
            Athlete Context.
          </strong>{" "}
          Background is how you got here as a runner. Experience is
          Beginner, Intermediate, or Advanced. Work/Life is job load, family
          weeks, health, and other constraints the coach should not forget.
        </p>
        <p>
          <strong className="font-semibold text-base-content">
            Historical PRs.
          </strong>{" "}
          Marks from before Strava so suggested paces stay honest. Event and
          era (high school through masters), time, and optional notes.
        </p>
        <p>
          <strong className="font-semibold text-base-content">
            Training zones.
          </strong>{" "}
          Easy, LT1, LT2, and VO2 in your language — paces, feel, or both. The
          coach uses these instead of generic charts.
        </p>
        <p>
          <strong className="font-semibold text-base-content">
            Shoes / gear.
          </strong>{" "}
          The locker comes from Garmin. Connect and sync Garmin first, then add
          a role or note on each pair. Tag shoes on Strava when you want a
          specific run tied to a specific pair.
        </p>
        <p>
          <strong className="font-semibold text-base-content">Device.</strong>{" "}
          The watch name comes from Garmin when you sync. The note is yours —
          optical wrist HR caveats belong here. The coach already treats
          optical HR with some caution.
        </p>
      </Section>

      <Section id="briefs-and-plans" title="Briefs and training plans">
        <p>
          The week strip at the top is the plan that counts. Treat it as this
          week’s calendar, not a suggestion the chat can quietly replace.
        </p>
        <p>
          <strong className="font-semibold text-base-content">
            Coach brief.
          </strong>{" "}
          The card with the runner icon is the coach’s summary of why this week
          looks like this. It starts as two lines; tap the chevron to read the
          rest.
        </p>
        <p>
          <strong className="font-semibold text-base-content">
            Plan this week / Regenerate / Update this week.
          </strong>{" "}
          Those buttons write a new week from your profile, the training
          philosophy, recent Strava, and — when you have been talking — the
          recent chat. Chat does not save a one-day patch by itself. When the
          coach agrees to a concrete change to this week, Update this week
          appears next to Send — tap it so the strip matches. It is not there
          on ordinary questions. Regenerate on the strip or in Look ahead still
          writes a full week and will also honor recent chat.
        </p>
        <p>
          Each day card shows the kind of session, the title, and what you
          actually did — a run summary, a rest check, missed, or a dash if the
          day is still ahead. Tap a day for a day brief. On rest days, check
          the circle when you actually rested.
        </p>
        <p>
          Look ahead opens this week plus the next three. Hide tucks the strip
          so you can talk to the coach with more room; Show brings it back.
        </p>
      </Section>

      <Section id="honest-gaps" title="What this app still doesn’t do">
        <p>
          Turnova is already useful as a private coach. It is not yet something
          you can hand a friend and walk away. These are the honest gaps:
        </p>
        <p>
          One shared password, no reset, and no personal accounts. One athlete
          profile and one chat for the whole app — so a friend’s Strava would
          land on the same locker.
        </p>
        <p>
          There is no Strava disconnect in the interface. Garmin connect can
          fail from the hosted server. The first Strava history load is slow
          and can pause. The underlying training doctrine is not something you
          can edit in the app.
        </p>
        <p>
          If you are inviting someone, walk them through this page first — and
          assume you still need to be nearby for password, Garmin, and that
          first Strava sync.
        </p>
      </Section>
    </div>
  );
}
