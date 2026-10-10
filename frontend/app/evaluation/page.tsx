import type { Metadata } from "next";
import { EvaluationView } from "@/components/EvaluationView";

export const metadata: Metadata = { title: "Evaluation · AI Incident Triage" };

export default function EvaluationPage() {
  return <EvaluationView />;
}
