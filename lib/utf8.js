// File-name encoding is selected by the native locale when a JVM starts.
// A JS string/HTTP charset alone cannot repair names decoded under the C locale.
const locale = process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8';
function environment(input = process.env) {
  const options = String(input.JAVA_TOOL_OPTIONS || '').replace(/(^|\s)(?:"-Dfile\.encoding=[^"]*"|'-Dfile\.encoding=[^']*'|-Dfile\.encoding=\S+)/g, '$1').trim();
  return { ...input, LANG: locale, LC_ALL: locale, LC_CTYPE: locale,
    JAVA_TOOL_OPTIONS: [options, '-Dfile.encoding=UTF-8'].filter(Boolean).join(' ') };
}
// Each stream needs its own incremental decoder; Buffer.toString per chunk
// loses a multibyte character split between reads (including inside NDJSON).
function streams(...readable) { for (const stream of readable) stream?.setEncoding('utf8'); }
module.exports = { environment, streams };
