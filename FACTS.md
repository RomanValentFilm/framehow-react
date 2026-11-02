# FRAMEHOW — WHAT ROMAN ALREADY HAS (read BEFORE any advice that costs him time or money)

Every line here comes from our own notes (TOMORROW.md, CLAUDE.md, the code).
Add to it the moment something new is set up. If a question touches any of
this, quote the line here — never answer from general knowledge first.

## Company
- EXACT NAME: "Tinge Films s.r.o." (with the dots; Roman 2 Nov) — Prague, Czech Republic, VAT payer.
- Named on framehow.com: privacy.html "Framehow is operated by Tinge Films
  s.r.o., Czech Republic"; terms.html address block "Tinge Films s.r.o.".
- Tinge Films s.r.o., Mělnická 579/7, 150 00 Praha, Czech Republic (exact, Roman 2 Nov).
  IČO 01574400 · VAT (DIČ) CZ01574400 (Roman, 2 Nov).
- Footer company line + /imprint page: dev site AND live framehow.com (2 Nov, route framehow.com/imprint* added).

## Domains
- framehow.com — registered with Gransy s.r.o. (Webglobe); nameservers at
  CLOUDFLARE (we control DNS). www → framehow.com (Cloudflare redirect rule).
- valentfilm.com, tingefilms.com — hosted by a friend in Germany (NOT Cloudflare).
  tingefilms.com shows valentfilm's page.

## Email
- info@framehow.com — a REAL inbox: framehow.com's MX is Google (Roman's Gmail
  sends as framehow.com). The app sends its mail from it (Cloudflare Email Sending).
  Budget alerts go there. → usable as the company work email (e.g. for Apple).
- WHERE framehow.com ADDRESSES LIVE (Roman's Admin console, 2 Nov): Google Workspace
  Business Starter, 1 licence, €8.10/month (Flexible), admin roman@valentfilm.com.
  Primary domain valentfilm.com. framehow.com = "User alias domain for valentfilm.com"
  (twitchy-eye.com too) → EVERY valentfilm.com address and its aliases also exists
  @framehow.com automatically (roman@framehow.com = roman@valentfilm.com's inbox).
  Nothing to make at Gransy/Webglobe or Cloudflare.
- info@framehow.com = the Google GROUP "Framehow INFO group" (info@valentfilm.com,
  1 member: Roman), mirrored by the alias domain. User aliases: roman.valent@,
  valent@ (so also roman@, roman.valent@, valent@ @framehow.com). Found 2 Nov.
- Apple ID plan: roman@framehow.com (not the public info@).
- framehow.com mail check in Admin (2 Nov): MX Complete, SPF Complete, DKIM MISSING
  (only Gmail's own sent mail; the app signs on cf-bounce).
- roman@valentfilm.com — hosted by the friend in Germany.
- roman@armadaplus.cz — also receives Cloudflare budget alerts.

## Cloudflare (one account, roman@valentfilm.com's Account)
- Workers Paid plan (since 9 Oct). Observability events: 0.
- framehow-react (Pages: framehow.com/app + dev), framehow-api (server),
  framehow-site (framehow.com website), framehow-site-dev, framehow-tracker,
  framehow (old Pages, 5 months).
- D1 database, R2 storage (500 MB per account; GLOBAL limit 50 GB).
- Budget alerts at $1 and $5.

## GitHub
- RomanValentFilm/framehow-react — main = framehow.com/app (live).

## Apple
- 2 Nov: Apple ID roman@framehow.com created; D-U-N-S lookup for "Tinge Films s.r.o."
  FOUND instantly (number is in Apple's email, not copied here). Next: Enroll now
  → Company/Organization, framehow.com, then pay 99 USD after Apple verifies.
- 2 Nov: ENROLMENT SUBMITTED (Company/Organization, web). Apple: "being processed —
  once we verify your authority to sign, we'll email instructions" (to roman@framehow.com
  = Roman's valentfilm inbox). Then pay 99 USD. Apple may ask for company documents.
- No developer account yet (2 Nov). Plan: enrol as "Tinge Films s.r.o."
  (needs D-U-N-S — check Apple's lookup first; company website + work email:
  framehow.com + info@framehow.com).
