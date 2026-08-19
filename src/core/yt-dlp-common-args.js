/**
 * Shared yt-dlp flags for every spawn.
 * YouTube needs a JS runtime + EJS solver; missing either yields HTTP 403.
 */
export function buildCommonYtdlpArgs() {
  return [
    '--no-update',
    '--js-runtimes',
    'deno',
    '--js-runtimes',
    'node',
    '--remote-components',
    'ejs:github',
  ];
}
