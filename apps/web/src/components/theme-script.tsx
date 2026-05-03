/**
 * Inline script that runs before React hydrates so the page renders in the
 * correct theme on first paint (no flash). Reads localStorage, falls back to
 * system preference.
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
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
