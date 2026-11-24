# Sharabaty – Online Sock Store

A complete sock store: storefront, cart, checkout (Cash on Delivery) and an admin dashboard. Pure HTML, CSS and vanilla JavaScript — no build step, hosted on GitHub Pages (or Netlify/Vercel). Products and orders are stored online in **Supabase**, so changes made in the admin are visible to every visitor.

> **Start here: [`SETUP-SUPABASE.md`](SETUP-SUPABASE.md)** — a 15-minute, step-by-step guide to connect the database.

```
sharabaty/
├── index.html           Storefront, cart drawer, checkout modal
├── admin.html           Admin dashboard (orders, inventory, products)
├── styles.css           All styling (shared by both pages)
├── app.js               Data layer (Supabase), cart, checkout, admin logic
├── config.js            Your Supabase URL + anon key (you fill this in)
├── supabase-setup.sql   Run once in Supabase: tables, security rules, order logic
├── SETUP-SUPABASE.md    Step-by-step setup guide
└── README.md
```

## 1. Save the files

1. Create a folder called `sharabaty`.
2. Save the files above into it, keeping the exact file names (all in the same folder, no sub-folders).
3. Follow `SETUP-SUPABASE.md` to create the database and fill in `config.js`. Without it the store shows "We couldn't load the socks".

## 2. Test locally

Use a tiny local server (opening the files directly can block some features):

```bash
cd sharabaty

# Option A – Python (already installed on most machines)
python3 -m http.server 8080

# Option B – Node
npx serve .
```

Then open:

- Store: <http://localhost:8080/index.html>
- Admin: <http://localhost:8080/admin.html> — sign in with the email/password you created in Supabase

### Try the full flow

1. In the store, pick a color and size, click **Add to cart**.
2. Open the cart, change quantities, click **Checkout**.
3. Fill in name, phone, address and city.
4. Place the order (cash on delivery). Card is hidden until a real payment gateway is connected (§6).
5. Open `admin.html` (from any device) to see the order with its shipping address and total. Change its status, open **Details**, adjust stock, or add/edit products.

On a new, empty shop the admin's **Products** tab shows **Import starter socks**, which adds the 12 sample products.

## 3. Deploy

All three options only need the static files (index.html, admin.html, app.js, config.js, styles.css).

| Host | Steps |
| --- | --- |
| **Netlify** | Go to app.netlify.com → *Add new site* → *Deploy manually* → drag the `sharabaty` folder onto the page. |
| **Vercel** | Install the CLI (`npm i -g vercel`), run `vercel` inside the folder, accept the defaults (framework: *Other*, no build command). |
| **GitHub Pages** | Push the files to a repo → *Settings* → *Pages* → deploy from the `main` branch, `/ (root)`. |

## 4. Customize

Everything configurable is in the `CONFIG` object at the top of `app.js`:

- `currency` / `locale` – e.g. `'USD'` / `'en-US'`, `'EUR'` / `'de-DE'`, `'SAR'` / `'ar-SA'`
- `shippingFlat`, `freeShippingThreshold`
- `categories`, `sizes`, `lowStockThreshold`
- `cardPaymentsEnabled` (keep `false` until a real gateway is connected)

Delivery fee and free-delivery limit are enforced by the database too: if you change `shippingFlat` / `freeShippingThreshold`, change `c_flat_shipping` / `c_free_threshold` in `place_order` in `supabase-setup.sql` as well.

Brand colors and fonts are CSS variables at the top of `styles.css` (`--coral`, `--violet`, `--yellow`, …). Products are illustrated with generated SVG socks, so no image files are required — the color swatch recolors the sock live.

## 5. Security model

- **Data lives in Supabase**, not in the browser. Only the shopping cart stays in the visitor's browser.
- **Admin sign-in is real** (Supabase Auth). The browser holds only the public *anon* key; Row Level Security rules in the database mean visitors can read products and place orders, and **only emails listed in the `admins` table** can edit products, view orders or change statuses.
- **Orders are created on the server** (`place_order`): prices, delivery fee and stock are checked there, never trusted from the browser.
- **Card payments are not live.** The checkout card form was a simulation, so it is hidden and the server refuses card orders until you connect a real provider (see §6).

## 6. Connect a real card payment provider (Stripe example)

All payment logic is isolated in one function in `app.js`:

```js
async function processCardPayment(order, card) { ... }
```

It must resolve to `{ success: true, transactionId, last4 }` or `{ success: false, error }`. Replace its body with a real gateway call.

> **Check availability first.** Stripe is not available in every country. As far as I know, merchants based in Egypt generally can't open a Stripe account, and local gateways such as Paymob, Fawry or Kashier are used instead. They follow the same pattern shown below (server creates a payment → customer pays in the provider's secure fields/iframe → server confirms), so the structure of this guide still applies. Check your provider's docs for exact endpoints.

**Never send raw card numbers to your own server.** Use the provider's hosted fields so card data goes straight to them.

### Step-by-step with Stripe

1. Create a Stripe account and copy your **publishable key** (`pk_test_…`) and **secret key** (`sk_test_…`).
2. Add the Stripe script to `index.html` before `app.js`:
   ```html
   <script src="https://js.stripe.com/v3/"></script>
   ```
3. Create a serverless function that creates a PaymentIntent. Example for Vercel at `api/create-payment-intent.js`:
   ```js
   // npm i stripe   (and set STRIPE_SECRET_KEY in your Vercel project settings)
   const Stripe = require('stripe');
   const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

   module.exports = async (req, res) => {
     if (req.method !== 'POST') return res.status(405).end();
     // IMPORTANT: recompute the amount on the server from your own product
     // prices. Never trust a total sent by the browser.
     const amount = computeTotalInMinorUnits(req.body.items); // your function
     const intent = await stripe.paymentIntents.create({
       amount,                       // smallest currency unit, e.g. cents
       currency: 'usd',
       automatic_payment_methods: { enabled: true },
       metadata: { customer: req.body.customerName }
     });
     res.json({ clientSecret: intent.client_secret });
   };
   ```
4. Replace the card inputs in the checkout modal with a Stripe Payment Element container:
   ```html
   <div id="payment-element"></div>
   ```
5. Rewrite `processCardPayment` along these lines:
   ```js
   const stripe = Stripe('pk_test_YOUR_PUBLISHABLE_KEY');
   let elements;

   // Call when the customer selects "Card" (or opens checkout):
   async function mountPaymentElement(order) {
     const r = await fetch('/api/create-payment-intent', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ items: order.items, customerName: order.customer.name })
     });
     const { clientSecret } = await r.json();
     elements = stripe.elements({ clientSecret });
     elements.create('payment').mount('#payment-element');
   }

   async function processCardPayment(order) {
     const { error, paymentIntent } = await stripe.confirmPayment({
       elements,
       redirect: 'if_required'
     });
     if (error) return { success: false, error: error.message };
     return { success: true, transactionId: paymentIntent.id, last4: '••••' };
   }
   ```
6. Add a **webhook** (`payment_intent.succeeded`) on your server that marks the order as paid in your database. The webhook, not the browser, should be the source of truth for payment status.
7. Test with Stripe's test cards (`4242 4242 4242 4242`), then switch to live keys.

## 7. What's still worth adding

1. Notifications for new orders (email or WhatsApp) — e.g. a Supabase Database Webhook / Edge Function.
2. A real card gateway (§6).
3. Stricter limits on how often the same visitor can place orders (spam protection).

## 8. Feature checklist

- Responsive storefront with hero, category filters, search, sorting
- Product cards with color swatches (live recolor), size selector, stock badges
- Slide-out cart with quantity controls, free-delivery progress bar, persistent across reloads
- Checkout modal with validation: name, phone, address, city (+ optional notes)
- Cash on Delivery (card form kept in code, switched off, with a clear hook for a real gateway)
- Order confirmation screen
- Admin: real email/password sign-in, stats, orders table (payment method, shipping address, total), status updates, order details, CSV export, inventory editing, add/edit/delete products
- Stock is reduced on order and restored if an order is cancelled
- All user-provided text is HTML-escaped before display
- Keyboard accessible: Esc closes dialogs, visible focus, ARIA labels
