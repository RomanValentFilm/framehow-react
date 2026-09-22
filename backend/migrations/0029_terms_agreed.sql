-- WHEN THEY AGREED TO THE TERMS (22 Sept).
--
-- Roman: the account box asks "I agree to the Terms of Service and acknowledge
-- the Privacy Policy" before an account can be made. Asking is only worth
-- anything if the answer is kept, so the moment is written down here.
-- Accounts made before this have no moment: the column stays empty, which is
-- the truth — nobody asked them.
ALTER TABLE users ADD COLUMN terms_agreed_at INTEGER;
