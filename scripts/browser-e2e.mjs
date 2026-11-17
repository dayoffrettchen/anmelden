import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin = process.env.E2E_ORIGIN || 'http://127.0.0.1:8787';
let ready = false;
for (let attempt = 0; attempt < 80; attempt++) {
  try {
    const response = await fetch(origin + '/api/auth/me');
    if (response.ok) { ready = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(ready, 'Wrangler Worker did not start');

const browser = await chromium.launch({ headless: true });
let page;
const errors = [];
try {
  page = await browser.newPage();
  page.on('pageerror', err => errors.push(String(err)));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin);
  await page.locator('#create-panel').waitFor({ state: 'visible' });
  await page.locator('#trip-form [name=title]').fill('Browser-Testausflug');
  await page.locator('#trip-form [name=destination]').fill('Hannover');
  await page.locator('#trip-form [name=arrival]').fill('2027-04-10T11:30');
  await page.locator('#trip-form button').click();
  await page.locator('.trip').waitFor();

  // Add one seat as the organizer (Mara).
  await page.locator('.trip .offer').locator('..').locator('summary').click();
  await page.locator('.offer [name=pickup]').fill('Göttingen');
  await page.locator('.offer [name=capacity]').fill('1');
  await page.locator('.offer button').click();
  await page.waitForFunction(() => document.querySelector('.availability')?.textContent.includes('1 freier Platz'));

  // Oskar is signed in locally, but must not see an uninvited trip.
  await page.locator('#identity').selectOption('oskar');
  await page.waitForFunction(() => document.querySelectorAll('.trip').length === 0);
  await page.locator('#identity').selectOption('mara');
  await page.locator('.trip').waitFor();

  // Invite Oskar through the real UI and database.
  await page.locator('.trip .manage > summary').click();
  await page.locator('.invite-form [name=email]').fill('oskar@example.test');
  await page.locator('.invite-form button').click();
  await page.waitForFunction(() => document.querySelector('.invite-list')?.textContent.includes('oskar@example.test'));

  // Oskar sees the trip, reserves, and can cancel his own booking.
  await page.locator('#identity').selectOption('oskar');
  await page.locator('.trip').waitFor();
  await page.locator('.booking button:visible').click();
  await page.waitForFunction(() => document.querySelector('.cancel-booking:not([hidden])') !== null);
  assert.match(await page.locator('.availability').first().textContent(), /Ausgebucht/);
  await page.locator('.cancel-booking:visible').click();
  await page.waitForFunction(() => document.querySelector('.availability')?.textContent.includes('1 freier Platz'));

  // Test organizer cancellation and permission to see booking details.
  await page.locator('.booking button:visible').click();
  await page.waitForFunction(() => document.querySelector('.cancel-booking:not([hidden])') !== null);
  await page.locator('#identity').selectOption('mara');
  await page.locator('.trip .manage > summary').click();
  await page.waitForFunction(() => document.querySelector('.reservation-list')?.textContent.includes('oskar@example.test'));
  await page.locator('.reservation-list button').click();
  await page.waitForFunction(() => document.querySelector('.reservation-list')?.textContent.includes('Noch keine Reservierungen.'));
  assert.deepEqual(errors, []);
  console.log('Browser E2E successful: private access, invitation, booking, own cancellation, organizer cancellation');
} catch (error) {
  if (page) await page.screenshot({ path: 'e2e-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
