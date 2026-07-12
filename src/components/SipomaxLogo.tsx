export function SipomaxLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role="img"
      aria-label="Sipomax"
    >
      <defs>
        <linearGradient id="sipomax-red" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e5372f" />
          <stop offset="1" stopColor="#b3161e" />
        </linearGradient>
      </defs>

      {/* Brand badge */}
      <rect width="40" height="40" rx="11" fill="url(#sipomax-red)" />

      {/* Diagonal gloss — a subtle "clean shine" nod to car care */}
      <path d="M0 11 L18 0 L40 0 L0 29 Z" fill="#ffffff" opacity="0.10" />

      {/* Sipomax "S" monogram */}
      <path
        d="M27.5 14.5 C27.5 11.2 24 10 20 10 C15.4 10 12 11.9 12 15 C12 18 15 19.3 20 20 C25 20.8 28 22 28 25 C28 28.2 24.4 30 20 30 C15.8 30 12.6 28.6 12.2 25.6"
        stroke="#ffffff"
        strokeWidth="3.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
