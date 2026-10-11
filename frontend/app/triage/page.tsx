import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = { title: "Manual triage · TriageLens" };

export default function TriagePage() {
  return <Dashboard />;
}
