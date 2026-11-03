// Provider marks (lucide no longer ships brand icons) and the app logo.

export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-label="GitHub">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function GitLabIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fc6d26" aria-label="GitLab">
      <path d="M23.6 9.6l-.03-.09-3.27-8.52a.85.85 0 00-.84-.54.87.87 0 00-.5.19.87.87 0 00-.29.44l-2.2 6.75H7.53L5.33 1.08A.86.86 0 005.04.64a.87.87 0 00-.5-.19.85.85 0 00-.84.54L.43 9.5l-.03.09a6.07 6.07 0 002.01 7.01l.01.01.03.02 4.98 3.73 2.46 1.86 1.5 1.13a1.01 1.01 0 001.22 0l1.5-1.13 2.46-1.86 5.01-3.75.01-.01a6.07 6.07 0 002.01-7z" />
    </svg>
  );
}

export function ProviderIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  return kind === "gitlab" ? <GitLabIcon size={size} /> : <GitHubIcon size={size} />;
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="GitPilot">
      <defs>
        <linearGradient id="gp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f9dff" />
          <stop offset="1" stopColor="#3ecf8e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#gp-g)" />
      <path d="M22 14v36M22 24c0 8 20 6 20 16" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx="22" cy="14" r="5.5" fill="#fff" />
      <circle cx="22" cy="50" r="5.5" fill="#fff" />
      <circle cx="42" cy="42" r="5.5" fill="#fff" />
    </svg>
  );
}
