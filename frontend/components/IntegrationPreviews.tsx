import type { ReactNode } from "react";
import type { Delivery } from "@/lib/types";

// Renders each vendor's request body the way the vendor would display it. The
// input is always the exact payload the backend built for that API.

type Payload = Record<string, any>;

/** Slack mrkdwn subset: *bold*, newlines, <!here>. */
function Mrkdwn({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i} className="block">
          {line
            .replace("<!here>", "@here")
            .split(/(\*[^*]+\*)/g)
            .map((part, j) =>
              part.startsWith("*") && part.endsWith("*") ? (
                <strong key={j}>{part.slice(1, -1)}</strong>
              ) : part.includes("@here") ? (
                <span key={j}>
                  {part.split("@here")[0]}
                  <span className="rounded bg-amber-100 px-0.5 font-semibold text-amber-900">@here</span>
                  {part.split("@here")[1]}
                </span>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
        </span>
      ))}
    </>
  );
}

export function SlackPreview({ delivery }: { delivery: Delivery }) {
  const p: Payload = delivery.payload;
  const blocks: Payload[] = p.blocks ?? [];
  return (
    <div className="rounded-md border border-slate-200 bg-white font-sans">
      <div className="border-b border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-800"># {delivery.target.replace(/^#/, "")}</div>
      <div className="flex gap-2.5 px-3 py-3">
        <div aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white">
          AI
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-[13px] leading-5 text-slate-900">
          <p>
            <span className="font-bold">AI Triage</span>{" "}
            <span className="rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-600">APP</span>
          </p>
          {p.text?.startsWith("<!here>") && <Mrkdwn text={p.text.split(" ")[0]} />}
          {blocks.map((b, i) => {
            if (b.type === "header") return <p key={i} className="text-[15px] font-bold">{b.text.text}</p>;
            if (b.type === "section" && b.fields)
              return (
                <div key={i} className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {b.fields.map((f: Payload, j: number) => (
                    <div key={j}><Mrkdwn text={f.text} /></div>
                  ))}
                </div>
              );
            if (b.type === "section") return <div key={i}><Mrkdwn text={b.text.text} /></div>;
            if (b.type === "context")
              return <p key={i} className="text-xs text-slate-500">{b.elements[0].text}</p>;
            if (b.type === "actions")
              return (
                <div key={i} className="flex gap-2">
                  {b.elements.map((e: Payload, j: number) => (
                    <span
                      key={j}
                      className={`rounded border px-3 py-1 text-xs font-semibold ${
                        e.style === "primary" ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 text-slate-800"
                      }`}
                    >
                      {e.text.text}
                    </span>
                  ))}
                </div>
              );
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

export function TeamsPreview({ delivery }: { delivery: Delivery }) {
  const card: Payload = delivery.payload.attachments?.[0]?.content ?? {};
  return (
    <div className="rounded-md border border-slate-200 bg-[#f5f5f5] p-3 font-sans">
      <p className="mb-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">AI Triage</span> via Workflows · {delivery.target}
      </p>
      <div className="overflow-hidden rounded-md border-l-4 border-[#5b5fc7] bg-white p-3 shadow-sm">
        {(card.body ?? []).map((el: Payload, i: number) => {
          if (el.type === "FactSet")
            return (
              <dl key={i} className="my-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                {el.facts.map((f: Payload) => (
                  <div key={f.title} className="contents">
                    <dt className="font-semibold text-slate-700">{f.title}</dt>
                    <dd className="text-slate-900">{f.value}</dd>
                  </div>
                ))}
              </dl>
            );
          const cls = [
            el.size === "Large" ? "text-base" : el.size === "Small" ? "text-xs" : "text-[13px]",
            el.weight === "Bolder" ? "font-bold" : "",
            el.color === "Attention" ? "text-red-700" : el.isSubtle ? "text-slate-500" : "text-slate-900",
          ].join(" ");
          return <p key={i} className={cls}>{el.text}</p>;
        })}
        <div className="mt-2 flex gap-2">
          {(card.actions ?? []).map((a: Payload) => (
            <span key={a.title} className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold text-[#5b5fc7]">
              {a.title}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdfNode({ node }: { node: Payload }): ReactNode {
  if (node.type === "paragraph")
    return (
      <p className="text-[13px]">
        {(node.content ?? []).map((t: Payload, i: number) =>
          t.marks?.some((m: Payload) => m.type === "strong") ? <strong key={i}>{t.text}</strong> : <span key={i}>{t.text}</span>,
        )}
      </p>
    );
  if (node.type === "bulletList" || node.type === "orderedList") {
    const List = node.type === "bulletList" ? "ul" : "ol";
    return (
      <List className={`pl-5 text-[13px] ${node.type === "bulletList" ? "list-disc" : "list-decimal"}`}>
        {node.content.map((li: Payload, i: number) => (
          <li key={i}>{li.content.map((c: Payload, j: number) => <AdfNode key={j} node={c} />)}</li>
        ))}
      </List>
    );
  }
  return null;
}

const JIRA_PRIORITY_COLOR: Record<string, string> = {
  Highest: "text-red-700",
  High: "text-orange-600",
  Medium: "text-amber-600",
  Low: "text-sky-700",
};

export function JiraPreview({ delivery, issueKey }: { delivery: Delivery; issueKey?: string }) {
  const f: Payload = delivery.payload.fields ?? {};
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 font-sans">
      <p className="text-xs text-slate-500">
        Projects / {f.project?.key} / <span className="font-semibold text-slate-700">{issueKey ?? `${f.project?.key}-(new)`}</span>
      </p>
      <h5 className="mt-1 text-base font-semibold text-[#172b4d]">{f.summary}</h5>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-red-600" /> {f.issuetype?.name}
        </span>
        <span className={`font-semibold ${JIRA_PRIORITY_COLOR[f.priority?.name] ?? ""}`}>↑ {f.priority?.name}</span>
        {(f.labels ?? []).map((l: string) => (
          <span key={l} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{l}</span>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2 text-[#172b4d]">
        {(f.description?.content ?? []).map((n: Payload, i: number) => <AdfNode key={i} node={n} />)}
      </div>
    </div>
  );
}

const SNOW_PRIORITY: Record<string, string> = { "1-1": "1 - Critical", "1-2": "2 - High", "2-2": "3 - Moderate", "2-3": "4 - Low" };

export function ServiceNowPreview({ delivery, number }: { delivery: Delivery; number?: string }) {
  const p: Payload = delivery.payload;
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-2 py-1">
      <span className="text-right text-xs text-slate-500">{label}</span>
      <span className="rounded border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-900">{value}</span>
    </div>
  );
  return (
    <div className="rounded-md border border-slate-200 bg-[#f6f7f8] p-3 font-sans">
      <p className="mb-2 text-xs font-semibold text-[#293e40]">Incident · {number ?? "New record"}</p>
      {row("Short description", p.short_description)}
      {row("Assignment group", p.assignment_group)}
      {row("Business service", p.business_service)}
      {row("Impact / Urgency", `${p.impact} / ${p.urgency}`)}
      {row("Priority", SNOW_PRIORITY[`${p.impact}-${p.urgency}`] ?? "—")}
      {row("Contact type", p.contact_type)}
      {row("Work notes", <span className="whitespace-pre-wrap">{p.work_notes}</span>)}
    </div>
  );
}

export function CrmPreview({ delivery, caseNumber }: { delivery: Delivery; caseNumber?: string }) {
  const p: Payload = delivery.payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white font-sans">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-[#f3f3f3] px-3 py-2">
        <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded bg-[#f2cf5b] text-[10px] font-bold text-slate-900">
          C
        </span>
        <span className="text-xs text-slate-600">Case</span>
        <span className="text-sm font-semibold text-slate-900">{caseNumber ?? "New Case"}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3 text-[13px] sm:grid-cols-3">
        {(["Subject", "Priority", "Status", "Origin", "Type"] as const).map((k) => (
          <div key={k} className={k === "Subject" ? "col-span-2 sm:col-span-3" : ""}>
            <dt className="text-[11px] text-slate-500">{k}</dt>
            <dd className="text-slate-900">{p[k]}</dd>
          </div>
        ))}
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-[11px] text-slate-500">Description</dt>
          <dd className="whitespace-pre-wrap text-slate-800">{p.Description}</dd>
        </div>
      </dl>
    </div>
  );
}

export function VendorPreview({ delivery, reference }: { delivery: Delivery; reference?: string }) {
  switch (delivery.connector) {
    case "slack":
      return <SlackPreview delivery={delivery} />;
    case "teams":
      return <TeamsPreview delivery={delivery} />;
    case "jira":
      return <JiraPreview delivery={delivery} issueKey={reference} />;
    case "servicenow":
      return <ServiceNowPreview delivery={delivery} number={reference} />;
    case "crm":
      return <CrmPreview delivery={delivery} caseNumber={reference} />;
    default:
      return null;
  }
}

export const CONNECTOR_TILE: Record<string, { monogram: string; tile: string }> = {
  servicenow: { monogram: "SN", tile: "bg-emerald-700 text-white" },
  jira: { monogram: "JSM", tile: "bg-sky-700 text-white" },
  slack: { monogram: "S", tile: "bg-[#4a154b] text-white" },
  teams: { monogram: "T", tile: "bg-indigo-600 text-white" },
  crm: { monogram: "CRM", tile: "bg-teal-700 text-white" },
};
