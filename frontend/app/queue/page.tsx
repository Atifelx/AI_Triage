import type { Metadata } from "next";
import { TicketQueue } from "@/components/TicketQueue";

export const metadata: Metadata = { title: "Ticket queue · TriageLens" };

export default function QueuePage() {
  return <TicketQueue />;
}
