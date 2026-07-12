// Shared rounding helper for the finance modules (cashflow.js, datevexport.js)
// so the "round to 2 decimal places" idiom isn't repeated at every call site.
export function round2(amount) {
  return Math.round(amount * 100) / 100;
}
