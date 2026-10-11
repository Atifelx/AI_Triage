/** TriageLens mark: a lens over a priority stack (P1 red, P2 amber, P3 blue). */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} role="img" aria-label="TriageLens">
      <rect width="32" height="32" rx="8" fill="#0E1726" />
      <circle cx="14.5" cy="14.5" r="8.75" fill="none" stroke="#FFFFFF" strokeWidth="2" />
      <path d="M21 21l5 5" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="9.5" y="10" width="10" height="2.4" rx="1.2" fill="#F04438" />
      <rect x="9.5" y="13.4" width="7.5" height="2.4" rx="1.2" fill="#FDB022" />
      <rect x="9.5" y="16.8" width="5" height="2.4" rx="1.2" fill="#7CA0FF" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-ink">TriageLens</span>
        <span className="block text-[11px] text-muted">Incident triage</span>
      </span>
    </span>
  );
}
