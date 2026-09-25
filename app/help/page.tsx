import type { Metadata } from "next";
import { HelpGuide } from "@/components/HelpGuide";

export const metadata: Metadata = {
  title: "Help · Turnova",
  description:
    "A friendly guide to signing in, linking Strava and Garmin, filling your athlete profile, and using Turnova’s week plans.",
};

export default function HelpPage() {
  return (
    <main className="min-h-dvh bg-base-100">
      <HelpGuide />
    </main>
  );
}
