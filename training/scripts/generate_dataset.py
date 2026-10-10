#!/usr/bin/env python3
import argparse, json, random, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TAX=json.loads((ROOT/"docs/taxonomy.json").read_text(encoding="utf-8"))
DETAILS=json.loads((ROOT/"docs/cause_details.json").read_text(encoding="utf-8"))
ROLES=["finance analyst","sales manager","HR specialist","field engineer","support agent","executive assistant","project coordinator","security analyst","operations lead","new starter"]
SITES=["Mumbai office","Pune office","Bengaluru office","remote home network","London branch","Singapore office","shared-services floor","warehouse network","regional office","hybrid workspace"]
DEVICES=["Windows 11 laptop","managed desktop","corporate MacBook","shared kiosk","newly provisioned laptop","mobile device","VDI session","conference-room PC","engineering workstation","remote endpoint"]
TIMES=["after the latest sign-in","since this morning","after a device restart","following a policy update","after a password change","since the last management check-in","after an application update","during the first login of the day","after moving to a different network","intermittently over the last two hours"]
SERVICE={"authentication":"Microsoft 365 sign-in","identity":"enterprise application access","conditional_access":"Microsoft 365 access policy","endpoint":"endpoint productivity service","device_compliance":"device management","exchange":"Outlook and Exchange Online","sharepoint":"SharePoint Online","teams":"Microsoft Teams","network":"corporate network access","security":"identity security controls"}
IMPACT={
"P1":"a business-critical service is unavailable across multiple departments and at least two sites, with no safe workaround",
"P2":"multiple users in one department are blocked from a time-sensitive business workflow, with only a limited workaround",
"P3":"one user or one endpoint is affected, and other users are working normally",
"P4":"the user requests guidance or reports a minor issue; core service functionality remains available"
}
SCOPE_EVIDENCE={
"P1":"Service desk correlation confirms the same failure across multiple departments and at least two sites; no safe workaround is available.",
"P2":"The service desk confirmed multiple affected users in one department; other departments remain operational.",
"P3":"The service desk confirmed one affected user or endpoint and verified that other users are working normally.",
"P4":"Triage confirms no material service interruption; core functionality remains available and the request is low impact."
}
CONTEXTS=['The ticket records the approximate start time for log correlation.', 'The reporter supplied the affected service and did not include credentials or secrets.', 'The support agent recorded current scope before proposing remediation.', 'The first-line check has not changed configuration or permissions.', 'The ticket is for triage assistance; remediation requires an authorized human.', 'The service desk checked for a related known incident.', 'The user confirmed the resource name and intended workflow.', 'The agent captured the error details in the secure ticket record.', 'The issue should be reassessed if additional users report the same symptom.', 'The agent will verify recovery after any approved change.', 'The reporter confirmed whether a workaround is currently available.', 'The service owner has not yet approved a configuration change.', 'The ticket records the operating system and client involved.', 'The support agent noted the last known successful attempt.', 'The initial assessment did not reveal a confirmed platform-wide outage.', 'The issue was reported during a normal business workflow.', "The support agent recorded the affected user's business role.", 'The diagnostic evidence was copied from the relevant service log.', 'The ticket does not include passwords, tokens, or private keys.', 'The current policy configuration has not been modified during triage.', 'The reporter provided the affected site or network location.', 'The incident will be reassessed if the scope changes.', 'The support agent has not yet declared the incident resolved.', 'The initial checks were limited to read-only diagnostics.', 'The ticket includes a timestamp suitable for log correlation.', 'The user confirmed the expected application or resource.', 'The report distinguishes observed symptoms from suspected cause.', 'The assigned team must confirm the diagnosis before remediation.', 'The ticket has not been used to authorize a policy exception.', 'The support agent recorded whether related incidents are open.', 'The issue has not been reproduced on an unrelated endpoint.', 'The reporter described the failure without including sensitive content.', 'The service desk captured the error code where available.', "The proposed action must follow the organization's change process.", 'The ticket includes the affected workflow and reported business impact.', 'The agent has not disabled a security control to restore access.', 'The resource owner must approve any access change.', 'The service team will verify recovery after an approved fix.', 'The issue is pending confirmation by the service owner.', 'The report includes the approximate time zone for log review.', 'The support agent recorded the current workaround status.', 'The initial review did not delete user files or mailbox content.', 'The report has not been treated as proof of a root cause by itself.', 'The support agent will compare this event with relevant service logs.', 'The ticket includes a clear distinction between symptom and diagnostic evidence.', 'The proposed remediation preserves existing security requirements.', 'The reporter confirmed the issue affects a business task.', 'The agent recorded the current scope as reported or verified.', 'The issue should be escalated if evidence indicates wider impact.', "The ticket is awaiting an authorized technician's decision.", 'The agent will document the result of the next diagnostic check.']
def grammar_article(text):
    return re.sub(r"\ba ([aeiou])",r"an \1",text,flags=re.I)
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--seed",type=int,default=20261009)
    ap.add_argument("--out",default=str(ROOT/"data"))
    args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    allrows=[]
    # Rotate which severity labels receive the two extra examples for each class.
    for ci,rc in enumerate(TAX["root_causes"]):
        cause=rc["root_cause"]; cat=rc["category"]; options=DETAILS[cause]
        sevs=["P1"]*12+["P2"]*12+["P3"]*12+["P4"]*12
        extra=[["P1","P2"],["P2","P3"],["P3","P4"],["P4","P1"]][ci%4]
        sevs+=extra
        rng=random.Random(args.seed+ci); rng.shuffle(sevs)
        for j,sev in enumerate(sevs):
            role=ROLES[(j*3+ci)%len(ROLES)]; site=SITES[(j*7+ci)%len(SITES)]
            device=DEVICES[(j*9+ci)%len(DEVICES)]; timing=TIMES[(j*5+ci)%len(TIMES)]
            diagnostic,action=options[(j+ci)%len(options)]
            impact=IMPACT[sev]; scope=SCOPE_EVIDENCE[sev]
            templates=[
              f"A {role} at the {site} reports that {SERVICE[cat]} is failing on a {device} {timing}.",
              f"The service desk received a report from a {role} at the {site}: {SERVICE[cat]} is failing on a {device} {timing}.",
              f"During triage, a {role} at the {site} reported that {SERVICE[cat]} stopped working on a {device} {timing}.",
              f"A ticket was opened for {SERVICE[cat]} for a {role} at the {site}; the affected device is a {device}, and symptoms began {timing}."
            ]
            narrative=grammar_article(templates[j%len(templates)])
            incident=f"{narrative} Business impact: {impact}. Diagnostic evidence: {diagnostic}. Scope check: {scope} Additional context: {CONTEXTS[(j*3+ci)%len(CONTEXTS)]}"
            target={"category":cat,"severity":sev,"root_cause":cause,"evidence":[diagnostic,scope],"recommended_actions":[action],"human_review_required":True}
            instruction=("Triage the IT incident. Return exactly one JSON object with keys category, severity, root_cause, "
             "evidence, recommended_actions, human_review_required. Use only the supplied category and root_cause taxonomy. "
             "Severity must be P1, P2, P3, or P4 and must match the explicit impact and scope evidence. Evidence must be "
             "grounded in the ticket. Recommendations must be safe and specific. Keep human review required; do not claim "
             "that an action was executed or invent facts.")
            allrows.append({"id":f"ITSM-{ci+1:02d}-{j+1:03d}","category":cat,"severity":sev,"root_cause":cause,
              "instruction":instruction,"input":incident,"output":json.dumps(target,ensure_ascii=False,separators=(",",":")),
              "metadata":{"root_cause_label":rc["label"],"scenario_family":cause,"source_type":"controlled_synthetic_v3"}})
    # Stratify by both root cause and severity. Each cause has 12 or 13 examples
    # per severity; allocate 10 per severity to train, then distribute the rest
    # between validation and test so every split contains every severity label.
    splits={"train":[],"val":[],"test":[]}
    for ci,rc in enumerate(TAX["root_causes"]):
        group=[r for r in allrows if r["root_cause"]==rc["root_cause"]]
        by_severity={s:[] for s in ["P1","P2","P3","P4"]}
        for row in group: by_severity[row["severity"]].append(row)
        for sev,items in by_severity.items():
            random.Random(args.seed+100+ci+sum(ord(c) for c in sev)).shuffle(items)
            splits["train"]+=items[:10]
            remainder=items[10:]
            if len(remainder)==3:
                # Alternate whether validation or test receives the extra example.
                if ci % 2 == 0:
                    splits["val"]+=remainder[:2]; splits["test"]+=remainder[2:]
                else:
                    splits["val"]+=remainder[:1]; splits["test"]+=remainder[1:]
            else:
                splits["val"]+=remainder[:1]; splits["test"]+=remainder[1:]
    for name,rows in splits.items():
        random.Random(args.seed+{"train":1,"val":2,"test":3}[name]).shuffle(rows)
        with (out/f"incident_{name}_v3.jsonl").open("w",encoding="utf-8") as f:
            for row in rows: f.write(json.dumps(row,ensure_ascii=False)+"\n")
    print("Wrote", {k:len(v) for k,v in splits.items()})
if __name__=="__main__": main()
