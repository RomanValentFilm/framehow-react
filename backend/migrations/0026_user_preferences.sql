-- THE USER'S OWN DEFAULTS (#510).
--
-- Roman, 12 September: the six column names (SHOT, ANGLE, SKETCH, REFS, NEEDS,
-- NOTES and the labels on the cards) are per project — and the names you last
-- saved should be what your NEXT new project opens with, on any of your
-- devices. So they are kept with the account, as one small JSON blob. Nothing
-- else reads it; the app treats it as "what this person likes".
ALTER TABLE users ADD COLUMN preferences TEXT;
