// THE NAME THE APP GIVES A PROJECT NOBODY NAMED (12 October, Roman).
//
// An unnamed project goes to the server by itself — after a minute of work,
// or at once when other copies are waiting (#524, #530) — under a name like
// "Untitled 12 Oct 16:05", so nothing is ever lost and it can be told apart in
// the list. But that name is the APP's, not the person's: Roman pressed SAVE
// on a brand-new project and was never asked for a name, because the app had
// already given it one. So SAVE treats an app-given name as no name at all and
// asks, with an empty box (Roman: "do not pre fill the box").
//
// The name travels to other devices as the project's name, so this is decided
// by the SHAPE of the name alone — one builder, one judge, nothing else.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function provisionalName(d: Date = new Date()): string {
  return `Untitled ${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** True for a name the app invented — exactly the shape above, nothing else. */
export function isProvisionalName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^Untitled \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}:\d{2}$/.test(name);
}
