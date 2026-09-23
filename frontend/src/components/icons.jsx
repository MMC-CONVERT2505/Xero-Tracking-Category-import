import React from 'react';

// Small, consistent 1.5px stroke icon set - kept local (no icon-library
// dependency) since the set needed here is short and fixed.
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const IconGrid = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);
export const IconTag = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <path d="M11.5 3.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-.3.7l-9.5 9.5a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4l9.5-9.5a1 1 0 0 1 .7-.3Z" />
    <circle cx="15.5" cy="8.5" r="1.25" fill="currentColor" stroke="none" />
  </svg>
);
export const IconHistory = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 4.5v4h4" /><path d="M12 7.5V12l3 2" />
  </svg>
);
export const IconLink = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <path d="M9.5 14.5l5-5" /><path d="M8 16.5a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5l-.5.5" />
    <path d="M16 7.5a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5l.5-.5" />
  </svg>
);
export const IconSettings = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V19.5a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H4.5a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1-1.55V4.5a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10.5a1.7 1.7 0 0 0 1.55 1H19.5a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
  </svg>
);
export const IconHelp = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.2a2.5 2.5 0 1 1 3.65 2.22c-.7.4-1.15.86-1.15 1.68" /><path d="M12 17h.01" strokeWidth="2.2" />
  </svg>
);
export const IconLogout = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
  </svg>
);
export const IconUpload = (p) => (
  <svg viewBox="0 0 24 24" width="22" height="22" {...base} {...p}>
    <path d="M12 15.5V4" /><path d="M7.5 8.5 12 4l4.5 4.5" /><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </svg>
);
export const IconChevronDown = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" {...base} {...p}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconMenu = (p) => (
  <svg viewBox="0 0 24 24" width="20" height="20" {...base} {...p}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const IconClose = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconCheckCircle = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.3 2.3L16 10" /></svg>
);
export const IconAlertTriangle = (p) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...base} {...p}>
    <path d="M10.6 3.9 2.9 17.5a1.5 1.5 0 0 0 1.3 2.25h15.6a1.5 1.5 0 0 0 1.3-2.25L13.4 3.9a1.5 1.5 0 0 0-2.8 0Z" />
    <path d="M12 9.5v4" /><path d="M12 16.5h.01" strokeWidth="2.2" />
  </svg>
);
export const IconBuilding = (p) => (
  <svg viewBox="0 0 24 24" width="20" height="20" {...base} {...p}>
    <rect x="5" y="3.5" width="10" height="17" rx="1" /><path d="M9 8h2M9 12h2M9 16h2" />
    <path d="M15 9.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-3" />
  </svg>
);
