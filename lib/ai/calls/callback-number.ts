/** Convert a Yeastar caller number to the format used by the callback pilot. */
export function normalizeCallbackMobile(value: string): string | null {
  const number = value.trim().replace(/[\s().-]/g, "");
  const australian = /^(?:0|\+?61|0061)([23478]\d{8})$/.exec(number);
  if (australian) return `0${australian[1]}`;
  const sriLankan = /^(?:\+?94|0094)(7\d{8})$/.exec(number);
  return sriLankan ? `94${sriLankan[1]}` : null;
}

/** Invoice contacts can store Australian national digits without the +61 shown by the form. */
export function normalizeInvoiceCallbackNumber(value: string): string | null {
  const number = value.trim().replace(/[\s().-]/g, "");
  return normalizeCallbackMobile(number) ?? (/^[23478]\d{8}$/.test(number) ? `0${number}` : null);
}
