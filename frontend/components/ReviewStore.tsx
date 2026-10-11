"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReviewStatus, ReviewTicket } from "@/lib/integrations";

// In-memory store for review tickets. The app has no persistence layer, so (like
// the rest of the UI state) tickets survive page navigation but are lost on reload.

interface ReviewStoreValue {
  tickets: ReviewTicket[];
  /** Assigns a REV-#### id and stores the ticket; returns the stored ticket. One review ticket
   *  per AI analysis: adding the same analysis again returns the existing ticket. */
  addTicket: (ticket: Omit<ReviewTicket, "ticket_id" | "created_at" | "status">) => ReviewTicket;
  /** The review ticket created for an AI analysis, if any. */
  findByAnalysis: (requestId: string) => ReviewTicket | undefined;
  setStatus: (ticketId: string, status: ReviewStatus) => void;
  updateTicket: (ticketId: string, patch: Partial<ReviewTicket>) => void;
}

const ReviewStoreContext = createContext<ReviewStoreValue | null>(null);

const FIRST_ID = 1042;

export function ReviewStoreProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<ReviewTicket[]>([]);
  const nextId = useRef(FIRST_ID);
  // Synchronous mirror so two quick calls for the same analysis never create two tickets.
  const byAnalysis = useRef(new Map<string, ReviewTicket>());

  const findByAnalysis = useCallback((requestId: string) => byAnalysis.current.get(requestId), []);

  const addTicket = useCallback<ReviewStoreValue["addTicket"]>((ticket) => {
    const existing = byAnalysis.current.get(ticket.ai_analysis.request_id);
    if (existing) return existing;
    const stored: ReviewTicket = {
      ...ticket,
      ticket_id: `REV-${nextId.current++}`,
      created_at: new Date().toISOString(),
      status: "Pending Review",
    };
    byAnalysis.current.set(stored.ai_analysis.request_id, stored);
    setTickets((items) => [stored, ...items]);
    return stored;
  }, []);

  const setStatus = useCallback((ticketId: string, status: ReviewStatus) => {
    setTickets((items) => items.map((t) => (t.ticket_id === ticketId ? { ...t, status } : t)));
  }, []);

  const updateTicket = useCallback((ticketId: string, patch: Partial<ReviewTicket>) => {
    for (const [key, t] of byAnalysis.current) {
      if (t.ticket_id === ticketId) byAnalysis.current.set(key, { ...t, ...patch });
    }
    setTickets((items) => items.map((t) => (t.ticket_id === ticketId ? { ...t, ...patch } : t)));
  }, []);

  const value = useMemo(
    () => ({ tickets, addTicket, findByAnalysis, setStatus, updateTicket }),
    [tickets, addTicket, findByAnalysis, setStatus, updateTicket],
  );
  return <ReviewStoreContext.Provider value={value}>{children}</ReviewStoreContext.Provider>;
}

export function useReviewStore(): ReviewStoreValue {
  const value = useContext(ReviewStoreContext);
  if (!value) throw new Error("useReviewStore must be used inside <ReviewStoreProvider>");
  return value;
}
