-- EVERYONE FROM BEFORE THE CONFIRMATION RULE COUNTS AS CONFIRMED (9 Nov, 17:10 CET).
-- The 150 MB allowance for unconfirmed accounts went live today; the accounts
-- that exist already never received a confirmation mail (none was ever sent),
-- so they would all have dropped to 150 MB — Roman's own read "267 % full".
-- Accounts created before this moment are confirmed by decree.
UPDATE users SET email_verified = 1, email_verification_token_hash = NULL, email_verification_expires_at = NULL
 WHERE created_at < 1794240607411 AND email_verified = 0;
