// A FITTING'S CUSTOMISE STAYS IN THE FITTING (26 October, Roman).
//
// Customise remembers its names as the starting names for every NEW project.
// Saved inside a fitting, it made LOOKS / LOOK2 the names of every new
// landscape and 9:16 project. Since 087 a fitting's Customise changes that
// fitting only — and names that are a fitting's, already saved as defaults,
// are ignored.
//
//     npm run t -- -g "customise in a fitting"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const stripNames = (d: Device) => d.page.evaluate(() =>
  (window as never as { __fh_test: { stripButtonNames(): string[] } }).__fh_test.stripButtonNames());

test('customise in a fitting: the fitting is renamed, new landscape and 9:16 projects are not', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);

  say('a fitting, Customise saved with a strip named DRESS');
  await d.newProjectOfKind('FITTING CUSTOMISE', 'fitting', 2);
  await d.settle();
  await d.customise({ main: '', ver: 'DRESS', floor: '', refs: '', needs: '', notes: '',
    verLabel: '', floorLabel: '', refsLabel: '', needsLabel: '', notesLabel: '' });
  const inFitting = await stripNames(d);
  say(`   the fitting's strips: ${inFitting.join(' · ')}`);
  expect(inFitting, 'the fitting itself is renamed').toContain('DRESS');

  for (const kind of ['landscape', 'portrait'] as const) {
    await d.newProjectOfKind(`AFTER THE FITTING — ${kind}`, kind, 1);
    await d.settle();
    const names = await stripNames(d);
    say(`   a new ${kind} project: ${names.join(' · ')}`);
    expect(names, `a new ${kind} project does not take the fitting's names`).not.toContain('DRESS');
    expect(names, `nor the fitting's LOOKS`).not.toContain('LOOKS');
    expect(names[0], `it starts with the app's own names`).toBe('ANGLE');
  }
  await d.close();
});
