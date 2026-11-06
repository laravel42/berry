import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * Outbound mail for sign-in (magic link, password reset, 2FA OTP).
 *
 * Provider credentials never leave this module. A deployment with no SMTP
 * still gets a console transport in development so local flows work; in
 * production that configuration is refused so a silent console sink cannot
 * pretend mail was delivered.
 */

export interface MailMessage {
   to: string;
   subject: string;
   text: string;
   html?: string;
}

export interface Mailer {
   /** Where messages appear to come from. */
   readonly from: string;
   /** True when delivery is a real SMTP hop, not the console. */
   readonly delivers: boolean;
   send(message: MailMessage): Promise<void>;
}

export interface SmtpMailConfig {
   from: string;
   /** `smtp://` / `smtps://` URL, or host settings. */
   transport: string | SMTPTransport.Options;
}

/**
 * Cloudflare Email Service authenticated SMTP (Email Sending submission).
 *
 * Only port 465 with implicit TLS is supported — not STARTTLS on 587.
 * Username is the literal string `api_token`; the password is a Cloudflare
 * API token with Email Sending: Edit.
 * @see https://developers.cloudflare.com/email-service/api/send-emails/smtp/
 */
export const CLOUDFLARE_EMAIL_SMTP = {
   host: 'smtp.mx.cloudflare.net',
   port: 465,
   secure: true,
   user: 'api_token',
} as const;

/** Nodemailer transport options for Cloudflare Email Sending over SMTP. */
export function cloudflareSmtpTransport(password: string, user = CLOUDFLARE_EMAIL_SMTP.user): SMTPTransport.Options {
   return {
      host: CLOUDFLARE_EMAIL_SMTP.host,
      port: CLOUDFLARE_EMAIL_SMTP.port,
      secure: CLOUDFLARE_EMAIL_SMTP.secure,
      auth: { user, pass: password },
   };
}

export function createSmtpMailer(config: SmtpMailConfig): Mailer {
   const transporter = nodemailer.createTransport(config.transport);
   return {
      from: config.from,
      delivers: true,
      async send(message) {
         await transporter.sendMail({
            from: config.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
         });
      },
   };
}

/** Development sink: writes the message to stdout so links can be copied. */
export function createConsoleMailer(from: string): Mailer {
   return {
      from,
      delivers: false,
      async send(message) {
         const lines = [
            '[berry-mail]',
            `from: ${from}`,
            `to: ${message.to}`,
            `subject: ${message.subject}`,
            message.text,
         ];
         console.info(lines.join('\n'));
      },
   };
}

export function magicLinkMail(url: string): { subject: string; text: string; html: string } {
   return {
      subject: 'Your Berry sign-in link',
      text: `Sign in to Berry with this link (expires in 15 minutes):\n\n${url}\n\nIf you did not ask for this, you can ignore the email.`,
      html: `<p>Sign in to Berry with this link (expires in 15 minutes):</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p>If you did not ask for this, you can ignore the email.</p>`,
   };
}

export function resetPasswordMail(url: string): { subject: string; text: string; html: string } {
   return {
      subject: 'Reset your Berry password',
      text: `Choose a new Berry password with this link (expires in 15 minutes):\n\n${url}\n\nIf you did not ask for this, you can ignore the email.`,
      html: `<p>Choose a new Berry password with this link (expires in 15 minutes):</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p>If you did not ask for this, you can ignore the email.</p>`,
   };
}

export function twoFactorOtpMail(code: string): { subject: string; text: string; html: string } {
   return {
      subject: 'Your Berry verification code',
      text: `Your Berry verification code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for this, you can ignore the email.`,
      html: `<p>Your Berry verification code is <strong>${escapeHtml(code)}</strong>.</p><p>It expires in 10 minutes. If you did not ask for this, you can ignore the email.</p>`,
   };
}

function escapeHtml(value: string): string {
   return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
}
