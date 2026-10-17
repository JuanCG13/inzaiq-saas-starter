# Interface screenshots: provenance

The 23 images in `en/` were captured on 2026-10-17 by one automated browser tour of the running demo application. They are viewed through the [screen gallery](../screens.md) ([galería](../screens.es.md)). This record says how they were made, which states were reached by real flows, every shortcut the tour takes, how the image format was chosen and what is not shown.

## Reproduce

```bash
npx playwright install chromium   # once
npm run screenshots
```

`npm run screenshots` runs `playwright test -c playwright.screenshots.config.ts` and then `scripts/build-gallery.ts`. The configuration is separate from `playwright.config.ts`, so `npm run test:e2e` never writes images. The tour starts one development server (`npm run demo:setup && npm run dev`, webpack), opens one browser and walks the screens in the order of `tests/screenshots/tour.spec.ts`. It takes about 1.3 minutes.

- **Port 3000 must be free.** The configuration never reuses a running server, because the database is reset.
- **It resets `demo.db`.** `tests/screenshots/reset-demo-db.mjs` deletes the local demo database so the current English seed applies and the orders table holds only the tour's orders. It refuses to run unless `.env.local` is the demo configuration written by `npm run demo:setup`.
- **Custom Chromium.** The capture environment used a pre-installed Chromium through `PLAYWRIGHT_EXECUTABLE_PATH=<path to chrome> PLAYWRIGHT_EXTRA_ARGS='["--no-sandbox"]'`, the same variables `playwright.config.ts` reads.
- **Spanish.** `SCREENSHOT_LOCALE=es npm run screenshots` runs the identical tour against the Spanish interface (`/es/...`, buttons found through the Spanish message catalogs) and writes `docs/screenshots/es/`, which is git-ignored. It proves the tour does not depend on one language: the Spanish run passed on 2026-10-17 and produced 23 images (814,186 bytes). Those images are not published; the gallery uses the English ones.
- **Format comparison.** `SCREENSHOT_PROBE_DIR=<dir>` additionally writes PNG, WebP q85 and WebP q92 of three screens to `<dir>`.

## Environment

| Item | Value |
| --- | --- |
| Browser | Chromium 141.0.7390.37, headless, driven by Playwright 1.64.1 (Node.js v22.22.0, Linux) |
| Desktop viewport | 1440 × 900, device scale factor 1 |
| Phone viewport | 390 × 844, device scale factor 1, mobile emulation with touch |
| Browser settings | locale `en-US`, time zone UTC, light color scheme, `prefers-reduced-motion: reduce` (the application then disables its animations and transitions) |
| Server | Next.js 16.4.2 development server. Demo mode is forbidden in production builds, so the tour cannot use `next start` |
| Development badge | Hidden with `HIDE_DEV_INDICATOR=1`, which `next.config.ts` maps to the official `devIndicators: false` option. Other developers keep the badge |
| Fonts | The application's font stack falls back to the machine's sans-serif, which is Inter in the capture environment. Another machine renders another font |

## Data

- **Seed:** the six products of `seedDemo`, priced in USD (`NOMA-TEE-01` Essential tee, `NOMA-BAG-01` Urban backpack, `NOMA-SHOE-01` Everyday sneakers, `NOMA-LAMP-01` Table lamp, `NOMA-KNIT-01` Knit sweater with 4 units, `NOMA-CHAIR-01` Design chair). Product names, descriptions and categories are catalog data, so they stay in English in every language.
- **Created by the tour through the real interface:** three orders for the fictional customers Ada Example, Grace Sample and Linus Placeholder (addresses on the reserved `example.invalid` domain, phone numbers in the fictional 555-01xx range), one owner account (Olivia Owner), one business (NOMA Studio) and one dynamically registered OAuth client (Demo Assistant).
- Nothing real is shown and no payment is processed. Order references, the business ID and the dates are the ones of the capture run, so regenerating changes those pixels. The procedure is repeatable; the bytes are not.

## Screens and how each state was reached

No HTTP response is mocked or delayed and the DOM is never edited. States are reached with clicks, typing and the application's own APIs.

| Screen | Route | Viewport | How the state was reached |
| --- | --- | --- | --- |
| `storefront-hero` | `/en` | desktop | Opened the landing page. |
| `storefront-collection` | `/en#collection` | desktop | Opened the anchor URL, then one mouse-wheel turn of 150 px to bring the heading up. |
| `storefront-product` | `/en#collection` | desktop | Clicked a product card to open its dialog. |
| `storefront-mobile` | `/en` | phone | Opened the landing page in the phone context. |
| `not-found` | `/en/this-page-does-not-exist` | desktop | Opened an unknown URL; the tour asserts HTTP 404. |
| `bag-empty` | `/en/cart` | desktop | Opened the bag in a fresh browser context, before adding anything. |
| `bag-checkout` | `/en/cart` | desktop | Added Essential tee (from the product dialog), Urban backpack and Table lamp (from the cards), raised the tee to 2 with the quantity button, typed a fictional customer. |
| `order-received` | `/en/cart` | desktop | Pressed Place order. The server answered 201 and the receipt shows the saved order. |
| `checkout-return` | `/en/checkout/return` | desktop | Opened the page directly, with no pending checkout attempt in the tab. |
| `admin-orders` | `/en/admin` | desktop | Two more orders were placed through the storefront. In the admin, the first was completed and the second cancelled with the real confirmation dialog and `PATCH` requests; the third stays pending. |
| `admin-order-detail` | `/en/admin` | desktop | Opened the pending order. |
| `admin-overview` | `/en/admin` | desktop | Metrics and latest orders after the three orders reached their statuses. |
| `admin-products` | `/en/admin` | desktop | Opened Products; stock reflects the orders (a cancellation restocks). |
| `admin-product-editor` | `/en/admin` | desktop | Opened Edit on Essential tee. Nothing was changed. |
| `admin-stock` | `/en/admin` | desktop | Opened Stock on Knit sweater and typed 12 and a reason. The dialog was closed without saving. |
| `admin-agents` | `/en/admin` | desktop | Opened My agent. |
| `admin-settings` | `/en/admin` | desktop | Opened Settings, which includes the live operations card. |
| `admin-mobile` | `/en/admin` | phone | Opened the admin in the phone context. |
| `sign-in` | `/en/sign-in` | desktop | Opened the page. |
| `create-account` | `/en/sign-in` | desktop | Switched to account creation and typed the fictional owner. |
| `onboarding` | `/en/onboarding` | desktop | Submitted the form (real sign-up through Better Auth), arrived at onboarding and typed the business name and identifier. |
| `consent` | `/en/consent` | desktop | Created the business (real), registered a public client through the OAuth dynamic registration endpoint, built a PKCE (S256) authorization URL and opened it in the signed-in browser. The server redirected to `/en/consent` with signed parameters, which the page verifies before rendering. |
| `connections` | `/en/onboarding/connections` | desktop | Pressed Allow access on the consent screen (real consent), then opened the connection list. |

## Shortcuts and deviations

1. **Capture mechanism.** Images are encoded by Chromium through the DevTools protocol (`Page.captureScreenshot`), not by `page.screenshot`, which cannot write WebP. Before each capture the tour parks the pointer in the top-left corner (no hover state), drops keyboard focus (no caret or focus ring), waits for web fonts and for every image in view to finish loading, and fails if the generic image fallback is on screen.
2. **Scrolling.** Every page is scrolled to the top before capture, except the two collection screens, which keep the scrolled position described above.
3. **Demo administrator.** The administration screens run in the local demo mode (`DEMO_MODE=true`), which acts as the demo administrator whoever is signed in. That is why the admin shows "Demo" and "Demo administrator". The account created later in the tour is used only by the account screens.
4. **OAuth client.** The Demo Assistant is registered and authorized for real, but it is not an assistant. Its redirect URI is a small HTTP listener that the tour starts on `127.0.0.1` (random port), to receive the authorization code. The tour does not exchange the code for a token; `tests/auth-oauth.test.ts` covers that exchange. No real ChatGPT or Claude connection was tested or is shown.
5. **Unsaved dialogs.** The product editor is only opened, and the stock dialog holds typed values that are never submitted, so the seeded numbers are not changed by a restock.
6. **Console output.** The tour fails on any page error or console error from the application's origin. The only exceptions are the 404 message of the deliberate 404 page and one application defect that the tour reports at the end of every run instead of hiding (an invalid `pattern` on the onboarding form, listed in `KNOWN_APP_ISSUES` in the spec). Remove that entry when the defect is fixed.

## Image format

Chromium encodes WebP natively, so no image library is a dependency. Three representative screens (a dense image grid, a table, a form with small text) were captured in the same browser state as PNG, WebP quality 85 and WebP quality 92 (capture run of 2026-10-17):

| Screen | PNG | WebP q85 | WebP q92 | PSNR q85 / q92 against PNG |
| --- | --- | --- | --- | --- |
| `storefront-collection` | 336,701 B | 37,504 B | 52,086 B | 42.8 / 44.1 dB |
| `admin-orders` | 89,930 B | 31,068 B | 39,778 B | 44.7 / 46.2 dB |
| `consent` | 55,801 B | 22,340 B | 26,526 B | 45.2 / 45.7 dB |

The crops were enlarged to 300% and compared by eye. At q85, faint halo noise appears around the 9 to 12 px text and small icons. At q92 the text edges match the PNG. PNG was rejected on size: the collection alone is three times the 110 KB per-image budget. JPEG was not part of the comparison.

**Decision: WebP, quality 92.** It stays well inside the budgets and keeps small text clean. GitHub renders WebP in READMEs and Markdown. The set is 23 images, **778,468 bytes** in total; the largest file is `admin-agents` at 67,126 bytes. For comparison, an earlier complete run of the same tour at q85 totalled 610,562 bytes. The budgets are 110,000 bytes per image and 1,600,000 bytes for the set, enforced by `tests/screens-manifest.test.ts` together with the pixel size of each image. Captures are one viewport tall; no screen needed a full-page image.

## Not shown, and why

- **Error boundary (`error.tsx`).** It renders only when a page throws, which would need stopping the database or editing application code. The tour does neither.
- **Loading skeletons and route loading states.** They exist only while a request is in flight. Capturing them would need a delayed response, and this tour never delays HTTP.
- **Hosted payment (Stripe).** The tour uses the manual payment option. The return page is shown without a pending attempt; its verified and pending states, and Stripe's own checkout, need provider credentials and were not exercised.
- **Paused orders and the business notice on the storefront.** The settings card is shown in its default state.
- **Other roles and failures.** Cashier and viewer views, rejected sign-ins and server errors are not shown.
- **A phone view of every screen.** Only the storefront and the admin overview are captured at 390 px.
- **A real assistant operating the store.** No connection to a real MCP client was made.
