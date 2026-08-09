-- Whether this frame's last change was made while the device had no connection.
-- An offline change landing on top of an online one is a real conflict worth
-- asking the user about; two sequential online edits usually are not.
ALTER TABLE frames ADD COLUMN changed_offline INTEGER NOT NULL DEFAULT 0;
