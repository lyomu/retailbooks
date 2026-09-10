import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = 'DemoRetailBooks1!';
const PORTAL_CUSTOMER = 'demo.customer@retailbooks.local';

async function signIn(page: Page, email: string, destination: RegExp): Promise<void> {
  await page.goto(email === PORTAL_CUSTOMER ? '/portal/login' : '/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(destination);
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

test.describe('Phase 11 customer portal', () => {
  test.describe.configure({ mode: 'serial' });

  test('signs a portal customer in to their own surface, never the internal app', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'desktop', 'Sign-in journey runs once on desktop.');
    const browserErrors = collectBrowserErrors(page);

    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);
    await expect(page.getByRole('heading', { name: 'Karibu Retail Demo' })).toBeVisible();
    await expect(page.getByText('Documents and messages for Karibu Wholesale Ltd')).toBeVisible();
    // The portal shell is not the internal shell: no organization switcher, no internal nav.
    await expect(page.getByRole('button', { name: /Switch organization/ })).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  });

  test("lists only this customer's documents and opens one with its lines", async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'Mutation journeys run once on desktop.');
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);

    const documents = page.getByRole('table', {
      name: 'Documents shared with this customer account',
    });
    await expect(documents.getByRole('row')).not.toHaveCount(1);
    await expect(documents.getByText('invoice', { exact: true })).toBeVisible();
    await expect(documents.getByText('quote', { exact: true })).toBeVisible();

    await documents.getByRole('button').first().click();
    await expect(page.getByRole('region', { name: /^Document / })).toBeVisible();
    await expect(page.getByRole('table', { name: /^Lines on / })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Unit price' })).toBeVisible();
  });

  test('asks for confirmation before recording a quote decision', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'Mutation journeys run once on desktop.');
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);

    const quoteRow = page.getByRole('row').filter({ hasText: 'quote' }).first();
    await quoteRow.getByRole('button').first().click();

    const decline = page.getByRole('button', { name: 'Decline quote' });
    await expect(decline).toBeVisible();
    await decline.click();
    // A decision is irreversible from the customer's side, so it is confirmed rather than taken
    // on the first click.
    await expect(page.getByText(/Decline .*You can still ask a question/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Decline quote' })).toBeVisible();
  });

  test('sends a message about a document and shows it in the thread', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'Mutation journeys run once on desktop.');
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);

    await page
      .getByRole('table', { name: 'Documents shared with this customer account' })
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();

    const message = `Please confirm the delivery window. ${Date.now()}`;
    await page.getByPlaceholder('Ask a question about this document').fill(message);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(message)).toBeVisible();
  });

  test('shows a statement with a closing balance and an export control', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'Statement journey runs once on desktop.');
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);

    const statement = page.locator('#statement');
    await expect(statement.getByRole('heading', { name: 'Statement' })).toBeVisible();
    await expect(statement.getByText(/Closing balance/)).toBeVisible();
    await expect(statement.getByRole('table', { name: 'Statement transactions' })).toBeVisible();

    const download = page.waitForEvent('download');
    await statement.getByRole('button', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^statement-.*\.csv$/);
  });

  test('edits the customer contact details, including a billing address', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'Mutation journeys run once on desktop.');
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);

    const profile = page.locator('#profile');
    await expect(profile.getByLabel('Name')).toHaveValue('Karibu Wholesale Ltd');
    await profile.getByLabel('Phone').fill('+254700111222');
    await profile.getByRole('button', { name: 'Add billing address' }).click();
    await profile.getByLabel('Address line 1').fill('12 Biashara Street');
    await profile.getByLabel('City').fill('Nairobi');
    await profile.getByLabel('Country code').fill('KE');
    await profile.getByRole('button', { name: 'Save details' }).click();

    await expect(profile.getByText('Your contact details were updated.')).toBeVisible();
    await page.reload();
    await expect(page.locator('#profile').getByLabel('Phone')).toHaveValue('+254700111222');
  });

  test('reaches every portal control by keyboard alone', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'Keyboard journey runs once on desktop.');
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);

    const firstDocument = page
      .getByRole('table', { name: 'Documents shared with this customer account' })
      .getByRole('button')
      .first();
    await firstDocument.focus();
    await expect(firstDocument).toBeFocused();
    await page.keyboard.press('Enter');

    // Opening a document moves focus to its heading, so a keyboard user is not left behind in the
    // table with no idea the panel appeared.
    await expect(page.getByRole('region', { name: /^Document / })).toBeVisible();
    await expect(page.locator('.rb-portal__detail h2')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: /^Document / })).toHaveCount(0);
  });

  test('@visual portal overview baseline across viewports', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);
    await page.locator('#main-content').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('table', { name: /Documents shared/ })).toBeVisible();
    await expect(page.locator('#statement').getByText(/Closing balance/)).toBeVisible();
    await expect(page.locator('#profile').getByLabel('Name')).toBeVisible();
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

    await expect(page).toHaveScreenshot('portal-overview.png', { fullPage: true });
    expect(browserErrors).toEqual([]);
  });

  test('keeps wide tables inside their own scroller instead of scrolling the page', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'mobile', 'Narrow-viewport behaviour only.');
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);
    await expect(page.getByRole('table', { name: /Documents shared/ })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the portal must never scroll horizontally as a whole').toBeLessThanOrEqual(1);
  });
});

test.describe('Phase 11 internal collaboration', () => {
  test.beforeEach(() => {
    test.skip(
      test.info().project.name !== 'desktop',
      'Collaboration journeys run once on desktop.',
    );
  });

  test('offers comments, files, and activity on a transaction detail surface', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await signIn(page, 'demo.owner@retailbooks.local', /\/$/);

    await page.goto('/invoices');
    await page.getByRole('link', { name: 'Open' }).first().click();

    const collaboration = page.getByRole('region', { name: 'Collaboration' });
    await expect(collaboration).toBeVisible();
    await expect(collaboration.getByRole('tab', { name: 'Comments' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const note = `Checked against the delivery note. ${Date.now()}`;
    await collaboration.getByPlaceholder(/Add an internal comment/).fill(note);
    await collaboration.getByRole('button', { name: 'Post comment' }).click();
    await expect(collaboration.getByText(note)).toBeVisible();

    await collaboration.getByRole('tab', { name: 'Files' }).click();
    await expect(collaboration.getByRole('button', { name: 'Upload file' })).toBeVisible();

    await collaboration.getByRole('tab', { name: 'Activity' }).click();
    await expect(collaboration.getByText(/Sales invoice issued/i)).toBeVisible();
    expect(browserErrors).toEqual([]);
  });

  test('shares a comment with the customer and shows it in their portal', async ({ page }) => {
    await signIn(page, 'demo.owner@retailbooks.local', /\/$/);
    await page.goto('/invoices');
    await page.getByRole('link', { name: 'Open' }).first().click();

    const collaboration = page.getByRole('region', { name: 'Collaboration' });
    const shared = `Your invoice is ready to review. ${Date.now()}`;
    await collaboration.getByRole('checkbox', { name: 'Share with customer' }).check();
    await collaboration.getByPlaceholder(/visible to the customer/).fill(shared);
    await collaboration.getByRole('button', { name: 'Post comment' }).click();
    await expect(collaboration.getByText('Shared with customer')).toBeVisible();

    // Drop the internal session rather than hunting for a sign-out control: the point of this
    // test is what the customer sees, not how the staff member left.
    await page.context().clearCookies();
    await signIn(page, PORTAL_CUSTOMER, /\/portal$/);
    await page
      .getByRole('row')
      .filter({ hasText: 'invoice' })
      .first()
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByText(shared)).toBeVisible();
  });
});
