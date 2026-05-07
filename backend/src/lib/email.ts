import type { Env } from "../types";

// Email sending is stubbed for now. Wire up a provider (Resend, MailChannels,
// SendGrid, ...) by setting EMAIL_API_KEY + EMAIL_FROM secrets and replacing
// the body of `send()`.
//
// The auth flow calls these helpers and silently no-ops in the stub case so
// signup/forgot-password still succeed end-to-end during development. The
// generated token is also returned by the auth handlers in non-production
// for manual testing — see routes/auth.ts.

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function send(env: Env, msg: EmailMessage): Promise<void> {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    // Dev mode: log and skip. Replace with real provider integration later.
    console.log("[email:stub]", { to: msg.to, subject: msg.subject });
    return;
  }
  // TODO: integrate provider. Example for Resend:
  //   await fetch("https://api.resend.com/emails", {
  //     method: "POST",
  //     headers: {
  //       "Authorization": `Bearer ${env.EMAIL_API_KEY}`,
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify({
  //       from: env.EMAIL_FROM,
  //       to: msg.to,
  //       subject: msg.subject,
  //       text: msg.text,
  //       html: msg.html,
  //     }),
  //   });
  console.log("[email:not-implemented]", { to: msg.to, subject: msg.subject });
}

export async function sendVerificationEmail(env: Env, to: string, name: string, token: string) {
  const url = `${env.APP_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
  await send(env, {
    to,
    subject: `Verify your ${env.APP_NAME} email`,
    text: `Hi ${name},\n\nWelcome to ${env.APP_NAME}. Verify your email by opening this link:\n${url}\n\nIf you didn't sign up, you can ignore this message.`,
  });
}

export async function sendPasswordResetEmail(env: Env, to: string, name: string, token: string) {
  const url = `${env.APP_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;
  await send(env, {
    to,
    subject: `Reset your ${env.APP_NAME} password`,
    text: `Hi ${name},\n\nWe received a request to reset your password. Open this link to choose a new one (expires soon):\n${url}\n\nIf you didn't request a reset, you can ignore this message.`,
  });
}
