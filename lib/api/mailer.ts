import nodemailer from 'nodemailer';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeHexColor(input: string): string {
  const trimmed = input.trim();
  if (!/^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(trimmed)) {
    return '#111111';
  }
  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return trimmed;
}

function createOtpEmailHtml(code: string, accentColor?: string | null, heading = 'Verification Code', bodyText = 'Use this one-time code to complete your sign in. The code expires in 10 minutes.') {
  const accent = normalizeHexColor(accentColor || '#111111');
  const cells = code
    .split('')
    .map(digit => `
      <td style="width:52px;height:60px;border:1px solid #d4d4d8;border-radius:10px;background:#ffffff;color:${accent};font-family:'SFMono-Regular','Menlo','Consolas',monospace;font-size:30px;font-weight:700;letter-spacing:0.02em;text-align:center;vertical-align:middle;">
        ${digit}
      </td>
    `)
    .join('<td style="width:8px;"></td>');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 16px;background:#f4f4f5;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden;background:#fafafa;">
            <tr>
              <td style="padding:22px 28px;background:#ffffff;border-bottom:1px solid #ececf0;">
                <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#71717a;">Z7I Scraper Security</p>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;color:${accent};font-weight:700;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 16px;">
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#27272a;">${bodyText}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto 8px;">
                  <tr>${cells}</tr>
                </table>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#71717a;">If you did not request this, you can safely ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendTwoFactorOtpEmail(params: {
  to: string;
  code: string;
  accentColor?: string | null;
}) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = getRequiredEnv('SMTP_USER');
  const pass = getRequiredEnv('SMTP_PASS');
  const from = process.env.SMTP_FROM || user;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: params.to,
    subject: 'Your Z7I Scraper verification code',
    text: `Your verification code is ${params.code}. It expires in 10 minutes.`,
    html: createOtpEmailHtml(params.code, params.accentColor),
  });
}


export async function sendPasswordResetOtpEmail(params: {
  to: string;
  code: string;
  accentColor?: string | null;
}) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = getRequiredEnv('SMTP_USER');
  const pass = getRequiredEnv('SMTP_PASS');
  const from = process.env.SMTP_FROM || user;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: params.to,
    subject: 'Your Z7I Scraper password reset code',
    text: `Your password reset code is ${params.code}. It expires in 10 minutes.`,
    html: createOtpEmailHtml(
      params.code,
      params.accentColor,
      'Password Reset Code',
      'Use this one-time code to reset your password. The code expires in 10 minutes.'
    ),
  });
}
