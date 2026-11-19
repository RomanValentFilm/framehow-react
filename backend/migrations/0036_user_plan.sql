-- THE PLAN OF AN ACCOUNT (19 November, list item 12).
--
-- Every account is on the plan 'free_launch' (Roman, 19 Nov: not plain 'free' —
-- "there might come some other free later"). The field does nothing yet:
-- it is here so that a plan can be given to an account later (testers who keep
-- free use, paid plans) without touching the accounts table under pressure.
-- No billing code anywhere.
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free_launch';
