export function SipomaxLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-label="Sipomax"
    >
      <rect width="40" height="40" rx="10" fill="#4f46e5" />
      {/* Stylized "C" arc */}
      <path
        d="M26 12 C18 10 11 15 11 20 C11 25 18 30 26 28"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Flow lines — speed streaks to the right */}
      <line
        x1="20"
        y1="17"
        x2="30"
        y2="17"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="21"
        x2="30"
        y2="21"
        strokeWidth="2.5"
        stroke="white"
        strokeLinecap="round"
      />
    </svg>
  );
}
