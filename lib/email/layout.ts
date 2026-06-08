import "server-only";

export type EmailDetailRow = { label: string; value: string };

/** Visual tone for the header band + highlight callout. */
export type EmailTone = "brand" | "success" | "warning" | "danger" | "neutral";

export type EmailTemplateContent = {
  /** Small eyebrow label above the title (e.g. "Inspection request"). */
  eyebrow?: string | null;
  title: string;
  /** Lead paragraph. Plain text — line breaks become paragraphs. */
  body: string;
  /** Optional greeting name, renders "Hi {name}," above the body. */
  greetingName?: string | null;
  tone?: EmailTone;
  details?: EmailDetailRow[];
  /** Highlighted callout (e.g. confirmed arrival window). */
  highlight?: string | null;
  highlightLabel?: string | null;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  /** Secondary note under the CTA. */
  footnote?: string | null;
  /** Business name shown in the footer; falls back to brand only. */
  businessName?: string | null;
  /** Optional logo (HTTPS) in the header band — used when platformLogoUrl is not set. */
  logoUrl?: string | null;
  /** BMS Pro Trade (or platform) logo in the blue header band. */
  platformLogoUrl?: string | null;
  /** Main headline in the blue header (e.g. "Welcome to BMS Pro Trade"). */
  headerHeadline?: string | null;
  /** Business logo shown at the top of the white body section. */
  bodyLogoUrl?: string | null;
  /** Blue header text + logo alignment (default left). */
  headerAlign?: "left" | "center";
  /** Styled two-line login card (email + password on separate rows). */
  loginCredentials?: {
    email: string;
    password: string;
    label?: string;
  } | null;
};

const BRAND = "BMS Pro Trade";

const TONES: Record<
  EmailTone,
  {
    headerFrom: string;
    headerTo: string;
    accent: string;
    highlightBg: string;
    highlightBorder: string;
    highlightText: string;
  }
> = {
  brand: {
    headerFrom: "#0b53d6",
    headerTo: "#0033a0",
    accent: "#0b53d6",
    highlightBg: "#eef4ff",
    highlightBorder: "#bcd2ff",
    highlightText: "#0b3aa0",
  },
  success: {
    headerFrom: "#0f9d6b",
    headerTo: "#047857",
    accent: "#059669",
    highlightBg: "#ecfdf5",
    highlightBorder: "#a7f3d0",
    highlightText: "#065f46",
  },
  warning: {
    headerFrom: "#d97706",
    headerTo: "#b45309",
    accent: "#d97706",
    highlightBg: "#fffbeb",
    highlightBorder: "#fde68a",
    highlightText: "#92400e",
  },
  danger: {
    headerFrom: "#e11d48",
    headerTo: "#9f1239",
    accent: "#e11d48",
    highlightBg: "#fff1f2",
    highlightBorder: "#fecdd3",
    highlightText: "#9f1239",
  },
  neutral: {
    headerFrom: "#475569",
    headerTo: "#334155",
    accent: "#475569",
    highlightBg: "#f1f5f9",
    highlightBorder: "#cbd5e1",
    highlightText: "#334155",
  },
};

const TEXT = "#1f2933";
const MUTED = "#64748b";
const BORDER = "#e6e9ef";
const SURFACE = "#eef1f6";

/** HTTPS URL or inline data URI (for embedded platform logos). */
function resolveEmailImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(body: string, color: string): string {
  const font =
    "'Finlandica','Saira',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:${color};font-family:${font};">${escapeHtml(
          para,
        ).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
}

/** Two-row login card for staff welcome emails (email clients use tables). */
function loginCredentialsBlock(
  credentials: NonNullable<EmailTemplateContent["loginCredentials"]>,
  tone: (typeof TONES)[EmailTone],
): string {
  const label = credentials.label ?? "Your login credentials";
  const email = escapeHtml(credentials.email);
  const password = escapeHtml(credentials.password);

  return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
          <tr>
            <td style="padding:3px;border-radius:14px;background:linear-gradient(135deg,${tone.headerFrom},${tone.headerTo});">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;background:#ffffff;">
                <tr>
                  <td style="padding:18px 20px 14px;">
                    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tone.accent};">${escapeHtml(label)}</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border-radius:10px;background:${tone.highlightBg};border:1px solid ${tone.highlightBorder};">
                      <tr>
                        <td style="padding:12px 14px;">
                          <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">Login email</p>
                          <p style="margin:0;font-size:15px;font-weight:700;color:${tone.highlightText};word-break:break-all;">${email}</p>
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;background:#f8fafc;border:1px dashed ${tone.highlightBorder};">
                      <tr>
                        <td style="padding:12px 14px;">
                          <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">Password</p>
                          <p style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.12em;font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;color:${TEXT};">${password}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`;
}

function detailRows(details: EmailDetailRow[]): string {
  return details
    .map(
      (row, index) => `
        <tr>
          <td style="padding:10px 0 ${
            index === details.length - 1 ? "0" : "10px"
          };font-size:13px;color:${MUTED};width:40%;vertical-align:top;border-bottom:${
            index === details.length - 1 ? "none" : `1px solid ${BORDER}`
          };">${escapeHtml(row.label)}</td>
          <td style="padding:10px 0 ${
            index === details.length - 1 ? "0" : "10px"
          };font-size:14px;color:${TEXT};font-weight:600;text-align:right;border-bottom:${
            index === details.length - 1 ? "none" : `1px solid ${BORDER}`
          };">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join("");
}

/** Builds a responsive, branded transactional HTML email. */
export function renderEmail(content: EmailTemplateContent): string {
  const tone = TONES[content.tone ?? "brand"];
  const title = escapeHtml(content.title);
  const eyebrow = content.eyebrow ? escapeHtml(content.eyebrow) : null;
  const greeting = content.greetingName
    ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${TEXT};font-weight:600;">Hi ${escapeHtml(
        content.greetingName,
      )},</p>`
    : "";

  const footerBusiness = content.businessName
    ? `${escapeHtml(content.businessName)} · powered by ${BRAND}`
    : BRAND;

  const headerBrand = content.businessName
    ? escapeHtml(content.businessName)
    : BRAND;
  const headerHeadlineText = content.headerHeadline
    ? escapeHtml(content.headerHeadline)
    : headerBrand;

  const headerAlign = content.headerAlign ?? "left";
  const headerCentered = headerAlign === "center";

  /** Wrap header logo in a centered table (margin:auto fails in many inboxes). */
  function wrapHeaderLogo(imgHtml: string, bottomSpacing: string): string {
    if (!headerCentered) return imgHtml;
    return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 ${bottomSpacing};">
          <tr>
            <td align="center" style="text-align:center;">
              ${imgHtml}
            </td>
          </tr>
        </table>`;
  }

  /** Platform logo in header when set; otherwise optional business logoUrl (other emails). */
  const platformHeaderLogo = resolveEmailImageUrl(content.platformLogoUrl);
  const headerLogoUrl =
    platformHeaderLogo ?? resolveEmailImageUrl(content.logoUrl);
  const logoBlock = headerLogoUrl
    ? platformHeaderLogo
      ? wrapHeaderLogo(
          `<img src="${escapeHtml(
            headerLogoUrl,
          )}" alt="${escapeHtml(BRAND)}" width="160" align="center" style="display:block;max-width:160px;width:160px;height:auto;margin:0 auto;border:0;" />`,
          "14px",
        )
      : wrapHeaderLogo(
          `<img src="${escapeHtml(
            headerLogoUrl,
          )}" alt="${escapeHtml(BRAND)}" width="46" height="46" align="center" style="display:block;width:46px;height:46px;border-radius:10px;object-fit:cover;background:#ffffff;margin:0 auto;" />`,
          "12px",
        )
    : "";

  /** Business logo in the white body section only. */
  const bodyLogoUrl = resolveEmailImageUrl(content.bodyLogoUrl);
  const bodyLogoBlock = bodyLogoUrl
    ? `<div style="margin:0 0 22px;text-align:center;">
        <img src="${escapeHtml(bodyLogoUrl)}" alt="${headerBrand}" width="80" height="80" style="display:inline-block;width:80px;height:80px;border-radius:14px;object-fit:contain;border:1px solid ${BORDER};background:#ffffff;padding:6px;" />
      </div>`
    : "";

  const credentialsBlock = content.loginCredentials
    ? loginCredentialsBlock(content.loginCredentials, tone)
    : "";

  const highlightBlock = content.highlight
    ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
          <tr>
            <td style="padding:16px 18px;border-radius:12px;background:${tone.highlightBg};border:1px solid ${tone.highlightBorder};">
              ${
                content.highlightLabel
                  ? `<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${tone.highlightText};opacity:0.8;">${escapeHtml(
                      content.highlightLabel,
                    )}</p>`
                  : ""
              }
              <p style="margin:0;font-size:16px;font-weight:700;color:${tone.highlightText};">${escapeHtml(
                content.highlight,
              )}</p>
            </td>
          </tr>
        </table>`
    : "";

  const detailsBlock =
    content.details && content.details.length > 0
      ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;padding:6px 16px;border:1px solid ${BORDER};border-radius:12px;background:#fbfcfe;">
          ${detailRows(content.details)}
        </table>`
      : "";

  const ctaBlock = content.ctaUrl
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
          <tr>
            <td style="border-radius:10px;background:${tone.accent};">
              <a href="${escapeHtml(content.ctaUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(
                content.ctaLabel || "View details",
              )}</a>
            </td>
          </tr>
        </table>`
    : "";

  const footnoteBlock = content.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(
        content.footnote,
      )}</p>`
    : "";

  const FONT_SANS =
    "'Saira','Finlandica',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const FONT_DISPLAY =
    "'Bitter','Saira',Georgia,'Times New Roman',Times,serif";
  const FONT_BODY =
    "'Finlandica','Saira',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light only" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${SURFACE};font-family:${FONT_SANS};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
      content.body.slice(0, 120),
    )}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 12px 36px -20px rgba(15,23,42,0.25);">
            <tr>
              <td align="${headerCentered ? "center" : "left"}" style="background:linear-gradient(135deg,${tone.headerFrom},${tone.headerTo});padding:26px 30px;text-align:${headerCentered ? "center" : "left"};">
                ${logoBlock}
                <p style="margin:0;font-size:17px;line-height:1.25;font-weight:800;letter-spacing:0.04em;color:#ffffff;text-align:${headerCentered ? "center" : "left"};font-family:${FONT_DISPLAY};">${headerHeadlineText}</p>
                ${
                  eyebrow
                    ? `<p style="margin:6px 0 0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.78);text-align:${headerCentered ? "center" : "left"};font-family:${FONT_SANS};">${eyebrow}</p>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                ${bodyLogoBlock}
                <h1 style="margin:0 0 16px;font-size:21px;line-height:1.25;color:${TEXT};font-weight:700;font-family:${FONT_DISPLAY};">${title}</h1>
                ${greeting}
                ${paragraphs(content.body, MUTED)}
                ${credentialsBlock}
                ${highlightBlock}
                ${detailsBlock}
                ${ctaBlock}
                ${footnoteBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px;border-top:1px solid ${BORDER};background:#fbfcfe;">
                <p style="margin:0;font-size:12px;color:${MUTED};">${footerBusiness}</p>
                <p style="margin:6px 0 0;font-size:11px;color:#9aa5b5;">This is an automated message — please do not reply directly to this email.</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#9aa5b5;">© ${new Date().getFullYear()} ${BRAND}. All rights reserved.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Backwards-compatible alias used by customer notification emails. */
export function renderCustomerEmail(content: EmailTemplateContent): string {
  return renderEmail(content);
}
