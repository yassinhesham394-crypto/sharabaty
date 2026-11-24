# Make your shop public: setup guide (about 15 minutes)

After this, **every change you make in the admin page is saved online and every visitor sees it**, and orders customers place show up in your admin from any device. Nothing to install. You only need a browser.

You will do 5 things: **create a free database → create your admin login → paste one script → paste two values into `config.js` → upload the files to GitHub.**

---

## Step 1. Create the database (Supabase)

1. Go to **supabase.com** → **Start your project** → sign up (GitHub login is fine).
2. Click **New project**.
   - Name: `sharabaty`
   - Database password: click *Generate*, and **save it somewhere** (you won't need it for this guide, but keep it).
   - Region: pick the closest one to Egypt (e.g. *Frankfurt* or *London*).
3. Wait ~2 minutes until the project finishes setting up.

## Step 2. Create your admin login

1. In the left menu click **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Type **your email** and a **strong password**. Tick **Auto Confirm User**. Click **Create user**.

This email and password are what you will use to sign in to `admin.html`. (The old `sock-admin` passcode no longer exists.)

## Step 3. Paste the setup script

1. Open the file **`supabase-setup.sql`** from this folder in any text editor (Notepad is fine).
2. Find the line marked `EDIT ME` and replace `YOUR_EMAIL@example.com` with **the same email you used in Step 2**. Only this email will be allowed into the admin.
3. Select everything in the file and copy it.
4. In Supabase click **SQL Editor** → **New query** → paste → click **Run**.
5. You should see **Success. No rows returned.** (Running it twice is safe.)

## Step 4. Connect the website to the database

1. In Supabase click the **⚙ Project Settings** → **API** (called **API Keys** in newer versions).
2. Copy two things:
   - **Project URL**: looks like `https://abcdefgh.supabase.co`
   - **anon public key**: a very long text starting with `eyJ`. (If the page only shows a key starting with `sb_publishable_`, use that one.)
3. Open **`config.js`** in a text editor, paste them between the quotes, and save:

```js
window.SHARABATY_SUPABASE = {
  url: 'https://abcdefgh.supabase.co',
  anonKey: 'eyJ...your long key...'
};
```

> ⚠️ Use only the **anon / public** key. **Never** put the `service_role` key (or your database password) in these files. The anon key is designed to be public; the security comes from the rules the script created.

## Step 5. Upload to GitHub

In your GitHub repository: **Add file → Upload files**, drag in these files, and click **Commit changes**:

`index.html` · `admin.html` · `app.js` · `config.js` · `styles.css`

(`config.js` is new. The other four replace the old ones. You do **not** need to upload `supabase-setup.sql` or this guide, though it does no harm.)

Wait about a minute for GitHub Pages to update, then hard-refresh your site (Ctrl+F5, or clear the browser cache on your phone).

## Step 6. First use

1. Open `your-site/admin.html` → sign in with the email and password from Step 2.
2. Go to the **Products** tab → click **Import starter socks** (appears only while your shop is empty). This adds the 12 sample socks to the database.
3. Edit stock, prices and photos as usual. **Everyone** now sees the changes.

### Test it properly
- On your phone, open the shop, add socks to the cart and place a test order (cash on delivery).
- On your laptop, open the admin → **Orders**. The order is there and the stock went down.
- Change that test order's status to **Cancelled**. The socks go back into stock automatically.

---

## Things to know

- **Your old changes stay in the old browser.** Products you edited before this setup live only in that browser's storage and are not copied over. The import gives you the starter socks, so re-enter your edits. Photos need to be uploaded again.
- **Card payments are switched off.** The old card form only *pretended* to charge. With a real shop that would let customers "pay" nothing, so the store now offers **cash on delivery only**. To add real card payments later you need a payment provider (see `README.md` §6), then set `cardPaymentsEnabled: true` in `app.js` **and** `c_cards_enabled` to `true` in the `place_order` function in the SQL.
- **Prices can't be faked.** When someone orders, the database recalculates prices, delivery fee and stock itself. Changing numbers in the browser does nothing.
- **Changing delivery fee or the free-delivery limit?** Change `shippingFlat` / `freeShippingThreshold` in `app.js` **and** `c_flat_shipping` / `c_free_threshold` near the top of `place_order` in the SQL (then run it again in the SQL editor).
- **Free plan pause.** As far as I know, Supabase pauses free projects after about a week with no activity. If your shop ever shows "We couldn't load the socks", open your Supabase dashboard and click **Restore project**. Regular orders keep it awake.
- **Forgot the admin password?** Supabase → Authentication → Users → your user → *Send password recovery*, or delete and re-create the user.
- **Adding another admin:** create the user in Authentication → Users, then in SQL Editor run:
  `insert into public.admins (email) values ('their@email.com');`
