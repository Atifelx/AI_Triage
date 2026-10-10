import type { IncidentFormValues } from "./validation";

// Hand-written example incidents for exercising the form. They are not taken
// from the training, validation or test datasets.
export const SAMPLE_INCIDENTS: IncidentFormValues[] = [
  {
    title: "Microsoft 365 sign-in failures",
    description: "Multiple employees cannot sign in.",
    affected_service: "Microsoft 365",
    affected_users: "45",
    affected_departments: ["Finance", "Operations"],
    affected_sites: ["Mumbai", "Pune"],
    business_impact: "Employees cannot access business applications.",
    workaround: "no",
    diagnostic_evidence: "Authentication failures reported by affected users.",
  },
  {
    title: "Finance print queue stuck",
    description: "Invoices sent to the shared finance printer never print.",
    affected_service: "Print services",
    affected_users: "12",
    affected_departments: ["Finance"],
    affected_sites: ["Mumbai"],
    business_impact:
      "Finance team cannot print invoices for month-end close; other departments are unaffected.",
    workaround: "yes",
    diagnostic_evidence: "Print queue shows jobs stuck in spooling state.",
  },
  {
    title: "Outlook crashes on one laptop",
    description: "Desktop Outlook closes immediately on launch for one user.",
    affected_service: "Outlook",
    affected_users: "1",
    affected_departments: ["Sales"],
    affected_sites: ["Pune"],
    business_impact: "One user cannot use desktop Outlook; other users are working normally.",
    workaround: "yes",
    diagnostic_evidence: "Application event log shows a faulting add-in module.",
  },
  {
    title: "Teams display name change request",
    description: "User asks for their Teams display name to be updated after a name change.",
    affected_service: "Microsoft Teams",
    affected_users: "0",
    affected_departments: ["HR"],
    affected_sites: ["London"],
    business_impact: "No service interruption; low-impact cosmetic request.",
    workaround: "unknown",
    diagnostic_evidence: "",
  },
];
