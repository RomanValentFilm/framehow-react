import type { Env } from "../types";

// ---------------------------------------------------------------------------
// MAIL (9 October). Roman took the Workers Paid plan and onboarded
// framehow.com for Cloudflare Email Sending, so the app can finally send for
// itself. Before today this file was a placeholder: no mail had ever left this
// server, and a forgotten password meant writing to Roman.
//
// There is NO key and NO secret here. Cloudflare's sending binding belongs to
// the Worker itself (`send_email` in wrangler.toml), so nothing has to be
// typed, stored or rotated.
//
// THE RULE ABOVE EVERYTHING: mail must never stand in the way. An account
// works the instant it is made, whether its welcome mail arrives or not, and
// asking for a new password must never show an error because a mail server
// was slow. Every failure here is written to the log and swallowed.
//
// Every mail is signed "Framehow". Never a person's name (Roman, 9 Oct).
// ---------------------------------------------------------------------------

const FROM = "info@framehow.com";          // people can answer it, which is the point in a beta
const FROM_NAME = "Framehow";

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** The same mail as HTML (9 Nov, Roman: "a nicer link, not a long URL").
   *  The text is always there too — some readers show only that. */
  html?: string;
}

// ---------------------------------------------------------------------------
// THE HTML VERSION (9 Nov): the text, line for line, with the one link as a
// button. Plain and dark like the app; nothing that needs images or fonts.
// ---------------------------------------------------------------------------
function escapeHtml(x: string): string {
  return x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Paragraphs in, HTML out; `{{BUTTON}}` in a paragraph becomes the link button. */
/**
 * A MAIL THAT LOOKS LIKE A MAIL (Roman, 10 November).
 *
 * No colours of our own: the dark page we set was dropped by Gmail, which kept
 * only our light-grey text — grey on white. The reader's own mail colours are
 * used, light or dark. A BLOCK is one or more lines that sit directly under
 * each other; between blocks there is one empty line, and nowhere else. A long
 * line wraps and goes on right below. The link is blue and underlined, the way
 * people know a link in a text; it is the line written as "{{BUTTON}}".
 */
function htmlMail(blocks: Array<string | string[]>, button?: { href: string; label: string; boldBlock?: boolean }): string {
  const line = (l: string) => (l === "{{BUTTON}}" && button
    ? `<a href="${escapeHtml(button.href)}" style="color:#1a73e8;text-decoration:underline">${escapeHtml(button.label)}</a>`
    : escapeHtml(l));
  const body = blocks.map((b, i) => {
    const own = Array.isArray(b) ? b : [b];
    const lines = own.map(line).join("<br>");
    // The block with the link in bold, where asked (the welcome mail, 10 Nov):
    // two links in that mail, and this is the one that matters.
    const bold = button?.boldBlock && own.includes("{{BUTTON}}") ? "font-weight:bold;" : "";
    return `<p style="${bold}margin:0 0 ${i === blocks.length - 1 ? "0" : "1.5em"}">${lines}</p>`;
  }).join("");
  return `<!DOCTYPE html><html><body><div style="font-family:-apple-system,system-ui,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">${body}</div></body></html>`;
}

/**
 * Hand one message to Cloudflare. Returns whether it went.
 *
 * Locally there is no binding (the simulator's worker has none), so the mail
 * is written to the log instead — which is what every test reads.
 */
async function send(env: Env, msg: EmailMessage): Promise<boolean> {
  if (!env.EMAIL) {
    console.log(`[email:not-sent-here] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return false;
  }
  try {
    const sent = await env.EMAIL.send({
      to: msg.to,
      from: `${FROM_NAME} <${FROM}>`,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    });
    console.log(`[email] sent to=${msg.to} subject="${msg.subject}" id=${sent?.messageId ?? "?"}`);
    return true;
  } catch (err) {
    // NEVER throw. The person's own action has already succeeded.
    console.log(`[email] FAILED to=${msg.to} subject="${msg.subject}" — ${String(err)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// WHERE THE LINK POINTS (9 October)
//
// Two faults were found in the old code on the way here:
//   1. the link was built as a page on THIS server, but the app reads its
//      token off its OWN address (`?reset=`), so the old link led nowhere;
//   2. the address was set to framehow.app, which is not where the app lives.
//
// The app tells us which address it is speaking from, because one server
// serves both the live app and dev. That is only trusted against a LIST WE
// HOLD — otherwise anyone could ask for a reset mail carrying a link to their
// own site, and the person would hand their account over by clicking it.
// Anything not on the list falls back to the live address.
// ---------------------------------------------------------------------------
export function appBase(env: Env, asked: string | null | undefined): string {
  const allowed = (env.APP_URLS ?? env.APP_URL ?? "")
    .split(/[\s,]+/)
    .map((s) => s.replace(/\/+$/, ""))
    .filter(Boolean);
  const want = (asked ?? "").replace(/\/+$/, "");
  if (want && allowed.includes(want)) return want;
  if (want) console.log(`[email] app address not on the list, using the live one: ${want}`);
  return allowed[0] ?? "https://framehow.com/app";
}

export function resetLink(env: Env, token: string, asked?: string | null): string {
  return `${appBase(env, asked)}/?reset=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// THE TWO MAILS — Roman's own words, 9 October. Do not reword without him.
// ---------------------------------------------------------------------------

export function verifyLink(env: Env, token: string, asked?: string | null): string {
  return `${appBase(env, asked)}/?verify=${encodeURIComponent(token)}`;
}

/** The welcome mail carries the confirmation link (9 Nov): one mail, not two.
 *  Until the link is opened the account has 150 MB; after it, the full 500. */
export async function sendWelcomeEmail(env: Env, to: string, name: string, verifyToken: string, asked?: string | null): Promise<boolean> {
  const link = verifyLink(env, verifyToken, asked);
  return send(env, {
    to,
    subject: "Welcome to Framehow",
    text: `Hi ${name},\n\n`
      + `Your Framehow account is ready — you can start straight away, on your iPhone, iPad or in a browser on your computer (www.framehow.com).\n\n`
      + `Please confirm your email address by opening this link:\n`
      + `${link}\n`
      + `Until then your account has 150 MB of storage; the link unlocks the full 500 MB.\n\n`
      + `Your work is kept on your device when you are offline, and syncs between your devices when you are online.\n\n`
      + `Feel free to send us a note if you have ideas about improvements.\n\n`
      + `Framehow\n`,
    html: htmlMail([
      `Hi ${name},`,
      `Your Framehow account is ready — you can start straight away, on your iPhone, iPad or in a browser on your computer (www.framehow.com).`,
      [`Please confirm your email address:`,
        `{{BUTTON}}`,
        `Until then your account has 150 MB of storage; confirming unlocks the full 500 MB.`],
      `Your work is kept on your device when you are offline, and syncs between your devices when you are online.`,
      `Feel free to send us a note if you have ideas about improvements.`,
      `Framehow`,
    ], { href: link, label: "Confirm email", boldBlock: true }),
  });
}

/** "Resend" (9 Nov): the confirmation link alone. */
export async function sendVerifyEmail(env: Env, to: string, name: string, verifyToken: string, asked?: string | null): Promise<boolean> {
  const link = verifyLink(env, verifyToken, asked);
  return send(env, {
    to,
    subject: "Confirm your Framehow email",
    text: `Hi ${name},\n\n`
      + `Open this link to confirm your email address for your Framehow account:\n`
      + `${link}\n\n`
      + `It unlocks the full 500 MB of storage for your account.\n\n`
      + `Framehow\n`,
    html: htmlMail([
      `Hi ${name},`,
      [`Confirm your email address for your Framehow account:`,
        `{{BUTTON}}`,
        `It unlocks the full 500 MB of storage for your account.`],
      `Framehow`,
    ], { href: link, label: "Confirm email" }),
  });
}

export async function sendPasswordResetEmail(
  env: Env, to: string, name: string, token: string, asked?: string | null,
): Promise<boolean> {
  const link = resetLink(env, token, asked);
  return send(env, {
    to,
    subject: "Your Framehow password",
    text: `Hi ${name},\n\n`
      + `Open the link below to choose a new password:\n`
      + `${link}\n\n`
      + `This link works for one hour.\n\n`
      + `Framehow\n`,
    html: htmlMail([
      `Hi ${name},`,
      [`Choose a new password for your Framehow account:`,
        `{{BUTTON}}`,
        `This link works for one hour.`],
      `Framehow`,
    ], { href: link, label: "Choose a new password" }),
  });
}

// ---------------------------------------------------------------------------
// MAIL TO ROMAN (12 Oct): the storage figures — every night, and at once when
// a step is crossed. Goes to ADMIN_EMAIL; never to a user.
// ---------------------------------------------------------------------------
export async function sendAdminMail(env: Env, subject: string, text: string): Promise<boolean> {
  if (!env.ADMIN_EMAIL) { console.log(`[email] no ADMIN_EMAIL — not sent: ${subject}`); return false; }
  return send(env, { to: env.ADMIN_EMAIL, subject, text });
}

// ---------------------------------------------------------------------------
// Confirming an address is NOT part of the beta (Roman, 22 Sept: "i don't want
// the user to do a confirmation of an account yet... he creates an account, he
// has the account immediately in the app and can use it"). The route that
// marks an address verified still exists on the server; nothing sends a
// verification mail, so nothing is kept here to build one.
// ---------------------------------------------------------------------------
