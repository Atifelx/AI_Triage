import type { Metadata } from "next";
import { ReviewsView } from "@/components/ReviewsView";

export const metadata: Metadata = { title: "Reviews · TriageLens" };

export default function ReviewsPage() {
  return <ReviewsView />;
}
