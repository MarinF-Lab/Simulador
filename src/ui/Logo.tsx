export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className + " shrink-0"} aria-hidden="true">
      <path
        d="M16 3l2.6 3.4 4.2-.9.6 4.2 3.8 2-2 3.8 2 3.8-3.8 2-.6 4.2-4.2-.9L16 29l-2.6-3.4-4.2.9-.6-4.2-3.8-2 2-3.8-2-3.8 3.8-2 .6-4.2 4.2.9z"
        fill="var(--color-accent)"
      />
      <circle cx="16" cy="16" r="5" fill="var(--color-panel)" />
      <circle cx="16" cy="16" r="2" fill="var(--color-accent)" />
    </svg>
  );
}
