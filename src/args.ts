/** Command-line flags of the tools and app entry points. */

/** The number after `--name` on the command line, or `fallback`. */
export function argInt(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? Number(process.argv[i + 1]) : fallback;
}
