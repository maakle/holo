import Script from 'next/script';

/**
 * Inline script that runs before React hydrates so the page renders in the
 * correct theme on first paint (no flash). Reads localStorage, falls back to
 * system preference.
 *
 * Uses next/script with strategy="beforeInteractive" — the only strategy
 * that fires before hydration. App Router restricts beforeInteractive to
 * the root layout, which is exactly where this is mounted. A bare <script>
 * tag triggers React 19's "scripts inside React components are never
 * executed when rendering on the client" hydration warning.
 */
const SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('holo.theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    if (resolved === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return (
    <Script id="holo-theme-init" strategy="beforeInteractive">
      {SCRIPT}
    </Script>
  );
}
