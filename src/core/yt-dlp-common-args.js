/**
 * Shared yt-dlp flags for every spawn.
 * YouTube needs a JS runtime + EJS solver; missing either yields HTTP 403.
 *
 * Cookies: when YouTube flags the server IP ("Sign in to confirm you're not a bot",
 * HTTP 429), yt-dlp needs an authenticated session. Configure via env:
 *   YTDLP_COOKIES              - path to a Netscape-format cookies.txt (preferred on servers)
 *   YTDLP_COOKIES_FROM_BROWSER - browser spec for --cookies-from-browser, e.g. "chrome" or "firefox:profile"
 * YTDLP_COOKIES wins if both are set.
 */
export function buildCommonYtdlpArgs() {
  const args = [
    '--no-update',
    '--js-runtimes',
    'deno',
    '--js-runtimes',
    'node',
    '--remote-components',
    'ejs:github',
  ];

  const cookiesFile = process.env.YTDLP_COOKIES?.trim();
  const cookiesBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  } else if (cookiesBrowser) {
    args.push('--cookies-from-browser', cookiesBrowser);
  }

  return args;
}
