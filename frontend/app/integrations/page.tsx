import type { Metadata } from "next";
import { IntegrationsView } from "@/components/IntegrationsView";

export const metadata: Metadata = { title: "Integrations · TriageLens" };

export default function IntegrationsPage() {
  return <IntegrationsView />;
}
