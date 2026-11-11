// Rounding and median as computed by the Supabase functions (supabase/schema.sql).

// num / den rounded to 2 decimals, half away from zero like Postgres numeric round; exact for integers.
export function round2(num, den) {
  return den ? Math.floor((200 * num + den) / (2 * den)) / 100 : null;
}
// percentile_cont(0.5)
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
