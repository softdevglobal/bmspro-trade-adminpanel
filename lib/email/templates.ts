import "server-only";

export type EmailDetailRow = { label: string; value: string };

export type CustomerEmailContent = {
  title: string;
  body: string;
  details?: EmailDetailRow[];
  highlight?: string | null;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  businessName?: string | null;
};

const BRAND = "BMS Pro Trade";
const COLORS = {
  primary: "#004ac6",
  text: "#1f2933",
  muted: "#6b7280",
  border: "#e5e7eb",
  surface: "#f5f7fb",
  highlight: "#ecfdf5",
  highlightText: "#065f46",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function detailRows(details: EmailDetailRow[]): string {
  return details
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.muted};width:42%;vertical-align:top;">${escapeHtml(
            row.label,
          )}</td>
          <td style="padding:6px 0;font-size:14px;color:${COLORS.text};font-weight:600;">${escapeHtml(
            row.value,
          )}</td>
        </tr>`,
    )
    .join("");
}

/** Builds a responsive, branded HTML email for a customer notification. */
export function renderCustomerEmail(content: CustomerEmailContent): string {
  const title = escapeHtml(content.title);
  const body = escapeHtml(content.body);
  const footerBusiness = content.businessName
    ? `${escapeHtml(content.businessName)} · powered by ${BRAND}`
    : BRAND;

  const highlightBlock = content.highlight
    ? `
        <div style="margin:20px 0 0;padding:14px 16px;border-radius:12px;background:${COLORS.highlight};border:1px solid #a7f3d0;">
          <p style="margin:0;font-size:14px;font-weight:700;color:${COLORS.highlightText};">${escapeHtml(
            content.highlight,
          )}</p>
        </div>`
    : "";

  const detailsBlock =
    content.details && content.details.length > 0
      ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;border-top:1px solid ${COLORS.border};padding-top:8px;">
          ${detailRows(content.details)}
        </table>`
      : "";

  const ctaBlock = content.ctaUrl
    ? `
        <div style="margin:28px 0 0;">
          <a href="${escapeHtml(content.ctaUrl)}" style="display:inline-block;background:${COLORS.primary};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px;">${escapeHtml(
            content.ctaLabel || "View details",
          )}</a>
        </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.surface};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.surface};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${COLORS.border};">
            <tr>
              <td style="background:${COLORS.primary};padding:20px 28px;">
                <p style="margin:0;font-size:16px;font-weight:800;letter-spacing:0.04em;color:#ffffff;text-transform:uppercase;">${BRAND}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0;font-size:20px;line-height:1.3;color:${COLORS.text};font-weight:700;">${title}</h1>
                <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:${COLORS.muted};">${body}</p>
                ${highlightBlock}
                ${detailsBlock}
                ${ctaBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid ${COLORS.border};">
                <p style="margin:0;font-size:12px;color:${COLORS.muted};">${footerBusiness}</p>
                <p style="margin:6px 0 0;font-size:11px;color:#9ca3af;">This is an automated message — please do not reply directly to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
