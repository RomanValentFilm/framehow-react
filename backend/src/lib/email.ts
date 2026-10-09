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

export async function sendWelcomeEmail(env: Env, to: string, name: string): Promise<boolean> {
  return send(env, {
    to,
    subject: "Welcome to Framehow",
    text: `Hi ${name},\n\n`
      + `Your Framehow account is ready — you can start straight away.\n\n`
      + `Your storyboards sync between your devices on their own, and your work is kept even when you are offline.\n\n`
      + `Feel free to send us a note if you have ideas about improvements.\n\n`
      + `Framehow\n`,
  });
}

export async function sendPasswordResetEmail(
  env: Env, to: string, name: string, token: string, asked?: string | null,
): Promise<boolean> {
  return send(env, {
    to,
    subject: "Your Framehow password",
    text: `Hi ${name},\n\n`
      + `Open the link below to choose a new password:\n`
      + `${resetLink(env, token, asked)}\n\n`
      + `This link works for one hour.\n\n`
      + `Framehow\n`,
  });
}

// ---------------------------------------------------------------------------
// Confirming an address is NOT part of the beta (Roman, 22 Sept: "i don't want
// the user to do a confirmation of an account yet... he creates an account, he
// has the account immediately in the app and can use it"). The route that
// marks an address verified still exists on the server; nothing sends a
// verification mail, so nothing is kept here to build one.
// ---------------------------------------------------------------------------
