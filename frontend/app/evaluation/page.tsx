import type { Metadata } from "next";
import { EvaluationView } from "@/components/EvaluationView";

export const metadata: Metadata = { title: "Evaluation · TriageLens" };

export default function EvaluationPage() {
  return <EvaluationView />;
}
