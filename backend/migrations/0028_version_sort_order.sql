-- A VERSION'S PLACE (#531). Reordering versions on a device swapped them and
-- relabelled them; the labels travelled, the order did not — the server had no
-- notion of it and the pull lined a shot's versions up by creation. After any
-- sync the pictures sat in their old places wearing swapped names.
ALTER TABLE versions ADD COLUMN sort_order INTEGER;
