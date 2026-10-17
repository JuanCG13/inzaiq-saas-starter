# Screen gallery

**English** · [Español](screens.es.md)

Every screen of the demo application, captured from a real running installation with the browser tour in `tests/screenshots/`. Select a thumbnail for the full-size image. Each caption names the route under the `/en` language prefix.

The data is the local demo seed (six sample products) plus a few fictional records that the tour creates through the real interface: customers on the reserved `example.invalid` domain, one sample owner account and one sample OAuth client. Nothing is real and no payment is processed. Order references and dates are the ones of the capture run.

The images are in English. This page repeats the captions in English; the [Spanish page](screens.es.md) has Spanish captions for the same images.

## Storefront

What a visitor sees before buying: the landing page, the collection, a product and the not-found page.

| | |
| --- | --- |
| <a href="screenshots/en/storefront-hero.webp" title="Full-size image"><img src="screenshots/en/storefront-hero.webp" width="360" alt="Landing page" /></a><br />**Landing page**<br />`/en` · Desktop 1440×900<br />The first screen of the demo store: announcement bar, header with language selector and bag, and the hero with its call to action. | <a href="screenshots/en/storefront-collection.webp" title="Full-size image"><img src="screenshots/en/storefront-collection.webp" width="360" alt="Collection" /></a><br />**Collection**<br />`/en#collection` · Desktop 1440×900<br />The product grid with category filters and search. Prices are formatted in the default currency and the images are the first-party SVG art in public/demo. |
| <a href="screenshots/en/storefront-product.webp" title="Full-size image"><img src="screenshots/en/storefront-product.webp" width="360" alt="Product detail" /></a><br />**Product detail**<br />`/en#collection` · Desktop 1440×900<br />The product dialog opened from the collection, with price, stock and the add-to-bag action. | <a href="screenshots/en/storefront-mobile.webp" title="Full-size image"><img src="screenshots/en/storefront-mobile.webp" width="180" alt="Storefront on a phone" /></a><br />**Storefront on a phone**<br />`/en` · Phone 390×844<br />The same landing page at 390 px wide; the layout collapses to one column. |
| <a href="screenshots/en/not-found.webp" title="Full-size image"><img src="screenshots/en/not-found.webp" width="360" alt="Page not found" /></a><br />**Page not found**<br />`/en/this-page-does-not-exist` · Desktop 1440×900<br />An unknown URL under a language prefix answers with a real HTTP 404 and this localized page. |  |

## Bag and checkout

The path from an empty bag to a saved order. Orders are placed with the manual payment option, so nothing is charged.

| | |
| --- | --- |
| <a href="screenshots/en/bag-empty.webp" title="Full-size image"><img src="screenshots/en/bag-empty.webp" width="360" alt="Empty bag" /></a><br />**Empty bag**<br />`/en/cart` · Desktop 1440×900<br />What a first-time visitor sees at the bag before adding anything. | <a href="screenshots/en/bag-checkout.webp" title="Full-size image"><img src="screenshots/en/bag-checkout.webp" width="360" alt="Bag with items and checkout form" /></a><br />**Bag with items and checkout form**<br />`/en/cart` · Desktop 1440×900<br />Three products (four items) in the bag and the customer form filled in with a fictional customer. The server recalculates the total when the order is placed. |
| <a href="screenshots/en/order-received.webp" title="Full-size image"><img src="screenshots/en/order-received.webp" width="360" alt="Order received" /></a><br />**Order received**<br />`/en/cart` · Desktop 1440×900<br />The confirmation after the real checkout request succeeded: reference, pending payment status and total. | <a href="screenshots/en/checkout-return.webp" title="Full-size image"><img src="screenshots/en/checkout-return.webp" width="360" alt="Return from payment" /></a><br />**Return from payment**<br />`/en/checkout/return` · Desktop 1440×900<br />The page a customer lands on after a hosted payment, opened here with no pending attempt in the tab. Coming back never confirms a charge by itself. |

## Administration

The business workspace: overview, catalog, inventory, orders, the agent connection guide and live settings.

| | |
| --- | --- |
| <a href="screenshots/en/admin-overview.webp" title="Full-size image"><img src="screenshots/en/admin-overview.webp" width="360" alt="Overview" /></a><br />**Overview**<br />`/en/admin` · Desktop 1440×900<br />Metrics, latest orders, products running low and quick actions for the demo business. | <a href="screenshots/en/admin-products.webp" title="Full-size image"><img src="screenshots/en/admin-products.webp" width="360" alt="Products" /></a><br />**Products**<br />`/en/admin` · Desktop 1440×900<br />The catalog table with price, inventory and publication status, plus the edit and stock actions. |
| <a href="screenshots/en/admin-product-editor.webp" title="Full-size image"><img src="screenshots/en/admin-product-editor.webp" width="360" alt="Product editor" /></a><br />**Product editor**<br />`/en/admin` · Desktop 1440×900<br />The edit dialog of an existing product. The price is entered in major units and saved as integer minor units. | <a href="screenshots/en/admin-stock.webp" title="Full-size image"><img src="screenshots/en/admin-stock.webp" width="360" alt="Stock adjustment" /></a><br />**Stock adjustment**<br />`/en/admin` · Desktop 1440×900<br />The inventory dialog with a restock typed in. It previews the new quantity; every saved adjustment is audited with its reason. |
| <a href="screenshots/en/admin-orders.webp" title="Full-size image"><img src="screenshots/en/admin-orders.webp" width="360" alt="Orders" /></a><br />**Orders**<br />`/en/admin` · Desktop 1440×900<br />Three orders placed through the storefront: one pending, one completed and one cancelled from the admin. | <a href="screenshots/en/admin-order-detail.webp" title="Full-size image"><img src="screenshots/en/admin-order-detail.webp" width="360" alt="Order detail" /></a><br />**Order detail**<br />`/en/admin` · Desktop 1440×900<br />A pending order with its lines, the customer contact details and the actions to confirm payment or cancel. |
| <a href="screenshots/en/admin-agents.webp" title="Full-size image"><img src="screenshots/en/admin-agents.webp" width="360" alt="Agent connection guide" /></a><br />**Agent connection guide**<br />`/en/admin` · Desktop 1440×900<br />Three steps to add the store as a remote MCP connection, with the endpoint to copy and example prompts. | <a href="screenshots/en/admin-settings.webp" title="Full-size image"><img src="screenshots/en/admin-settings.webp" width="360" alt="Settings" /></a><br />**Settings**<br />`/en/admin` · Desktop 1440×900<br />The live operations card (business notice and pause or resume of new orders) above the read-only identity and module settings. |
| <a href="screenshots/en/admin-mobile.webp" title="Full-size image"><img src="screenshots/en/admin-mobile.webp" width="180" alt="Administration on a phone" /></a><br />**Administration on a phone**<br />`/en/admin` · Phone 390×844<br />The overview at 390 px wide: the sidebar becomes a compact navigation bar. |  |

## Account and agent access

Sign-in, business creation and the OAuth consent that lets an assistant operate the business over MCP.

| | |
| --- | --- |
| <a href="screenshots/en/sign-in.webp" title="Full-size image"><img src="screenshots/en/sign-in.webp" width="360" alt="Sign in" /></a><br />**Sign in**<br />`/en/sign-in` · Desktop 1440×900<br />The sign-in page. It also receives the signed parameters of an OAuth authorization. | <a href="screenshots/en/create-account.webp" title="Full-size image"><img src="screenshots/en/create-account.webp" width="360" alt="Create account" /></a><br />**Create account**<br />`/en/sign-in` · Desktop 1440×900<br />The same page in account-creation mode with a fictional owner. Passwords need at least 12 characters. |
| <a href="screenshots/en/onboarding.webp" title="Full-size image"><img src="screenshots/en/onboarding.webp" width="360" alt="Create a business" /></a><br />**Create a business**<br />`/en/onboarding` · Desktop 1440×900<br />After sign-up the owner creates the business (organization) the agent connection will be limited to. | <a href="screenshots/en/consent.webp" title="Full-size image"><img src="screenshots/en/consent.webp" width="360" alt="OAuth consent" /></a><br />**OAuth consent**<br />`/en/consent` · Desktop 1440×900<br />A dynamically registered client asks for access using PKCE. The page only renders for genuinely signed parameters; write scopes start unchecked. |
| <a href="screenshots/en/connections.webp" title="Full-size image"><img src="screenshots/en/connections.webp" width="360" alt="Connected agents" /></a><br />**Connected agents**<br />`/en/onboarding/connections` · Desktop 1440×900<br />The client authorized on the previous screen, with its granted scopes, a disconnect button and the MCP URL. |  |

## Regenerate

Install the browser once with `npx playwright install chromium`, then run:

```bash
npm run screenshots
```

The command resets the local `demo.db`, starts the demo server, walks all 23 screens and rebuilds this page and its Spanish counterpart. `SCREENSHOT_LOCALE=es npm run screenshots` runs the same tour against the Spanish interface and writes the git-ignored `docs/screenshots/es/`.

How the captures were made, the image-format measurements, the disclosed shortcuts and what is not shown are recorded in [screenshots/PROVENANCE.md](screenshots/PROVENANCE.md).
