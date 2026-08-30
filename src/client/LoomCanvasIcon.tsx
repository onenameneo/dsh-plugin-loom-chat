/** Loom-specific canvas icon: session cards arranged inside a canvas frame. */
export function LoomCanvasIcon() {
  return (
    <svg
      data-loom-canvas-icon
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.75" y="2" width="12.5" height="12" rx="1.8" />
      <rect x="4" y="4.5" width="3.2" height="2.6" rx="0.55" />
      <rect x="8.8" y="8.9" width="3.2" height="2.6" rx="0.55" />
      <path d="M7.2 6.3 8.8 9" />
      <circle cx="8" cy="7.65" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
}
