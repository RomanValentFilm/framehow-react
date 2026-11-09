-- NEWS AND UPDATES (9 Nov): the moment the person ticked "send me news and
-- updates" when creating the account. NULL = did not. No mail is sent by the
-- app; this is the consent record, kept with the account.
ALTER TABLE users ADD COLUMN newsletter_consent_at INTEGER;
