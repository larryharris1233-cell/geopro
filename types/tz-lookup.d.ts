// tz-lookup ships no TypeScript declarations. Pure-JS lat/lon ->
// IANA time zone name lookup (build #24, item 5: arrival times are
// rendered in the DESTINATION's time zone).
declare module 'tz-lookup' {
  export default function tzLookup(lat: number, lon: number): string;
}
