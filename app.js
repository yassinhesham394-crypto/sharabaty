/* ===========================================================
   Sharabaty – app.js
   Shared by index.html (storefront) and admin.html (dashboard).
   Products and orders live in Supabase (see SETUP-SUPABASE.md);
   the shopping cart stays in the visitor's browser.
   =========================================================== */
(function () {
  'use strict';

  /* ===================== CONFIG ===================== */
  const CONFIG = {
    storeName: 'Sharabaty',
    currency: 'EGP',            // any ISO 4217 code, e.g. 'USD', 'EUR', 'SAR'
    locale: 'en-EG',            // controls number/date formatting
    shippingFlat: 50,           // delivery fee
    freeShippingThreshold: 600, // free delivery when subtotal >= this
    lowStockThreshold: 10,
    // Card payments are only SIMULATED. Keep false until a real gateway is connected
    // (also set c_cards_enabled in the SQL function place_order). See SETUP-SUPABASE.md.
    cardPaymentsEnabled: false,
    categories: ['Everyday', 'Sport', 'Cozy', 'Dress', 'Fun'],
    sizes: ['S', 'M', 'L'],
    keys: {
      cart: 'sharabaty.cart.v1'
    }
  };

  /* ===================== HELPERS ===================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  const currencyFmt = new Intl.NumberFormat(CONFIG.locale, {
    style: 'currency',
    currency: CONFIG.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  const money = (n) => currencyFmt.format(Number(n) || 0);

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString(CONFIG.locale, { dateStyle: 'medium', timeStyle: 'short' });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- product photos ---- */
  const MAX_PHOTOS = 4;
  const safeImg = (u) => typeof u === 'string' && (u.startsWith('data:image/') || u.startsWith('https://')) && !/["'<>\s]/.test(u);
  const productImages = (p) => (Array.isArray(p.images) ? p.images.filter(safeImg) : []);

  // Small thumbnail used in the cart and admin tables: first photo, or the drawn sock.
  function thumbHTML(p, mainHex) {
    const imgs = productImages(p);
    return imgs.length
      ? `<img src="${imgs[0]}" alt="${esc(p.name)}" loading="lazy">`
      : sockSVG(mainHex, p.accent, p.pattern, p.name);
  }

  // Reads an uploaded image, shrinks it (max 800px) and returns a compressed JPEG data URL
  // so several photos fit comfortably in the browser's storage.
  function fileToResizedDataURL(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      if (!file.type || file.type.indexOf('image/') !== 0) { reject(new Error('Not an image file')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not open that image'));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
  };

  /* ---- colour utilities ---- */
  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function mix(hex, targetHex, t) {
    const a = hexToRgb(hex);
    const b = hexToRgb(targetHex);
    const ch = (x, y) => Math.round(x + (y - x) * t);
    return `rgb(${ch(a.r, b.r)}, ${ch(a.g, b.g)}, ${ch(a.b, b.b)})`;
  }
  const tint = (hex, amount) => mix(hex, '#ffffff', amount);
  const shade = (hex, amount) => mix(hex, '#000000', amount);

  /* ---- toast ---- */
  function toast(message, type) {
    const wrap = $('#toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, 2800);
  }

  /* ---- sock illustration (inline SVG, no image files needed) ---- */
  const SOCK_PATH =
    'M36 10 L74 10 L74 70 C74 78 80 82 90 86 C106 92 114 100 112 116 ' +
    'C111 126 103 130 94 130 L48 130 C34 130 26 122 28 110 C29 102 34 96 36 86 Z';
  let artCounter = 0;

  function sockSVG(main, accent, pattern, label) {
    const id = 'sk' + (++artCounter);
    const outline = shade(main, 0.3);
    let deco = '';
    if (pattern === 'stripes') {
      for (let y = 34; y <= 70; y += 12) deco += `<rect x="30" y="${y}" width="50" height="5" fill="${accent}"/>`;
    } else if (pattern === 'bands') {
      deco += `<rect x="30" y="30" width="50" height="4" fill="${accent}"/><rect x="30" y="38" width="50" height="4" fill="${accent}"/>`;
    } else if (pattern === 'dots') {
      [[45, 38], [63, 46], [46, 56], [64, 64], [58, 112], [76, 120], [90, 108]].forEach(([x, y]) => {
        deco += `<circle cx="${x}" cy="${y}" r="3.6" fill="${accent}"/>`;
      });
    }
    let ribs = '';
    for (let x = 40; x < 74; x += 4) ribs += `<line x1="${x}" y1="10" x2="${x}" y2="24" stroke="rgba(0,0,0,.14)" stroke-width="1"/>`;
    return `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label || 'Sock')}">
      <defs><clipPath id="${id}"><path d="${SOCK_PATH}"/></clipPath></defs>
      <path d="${SOCK_PATH}" fill="${main}"/>
      <g clip-path="url(#${id})">
        ${deco}
        <rect x="30" y="8" width="50" height="16" fill="${accent}"/>
        ${ribs}
        <circle cx="36" cy="118" r="15" fill="${accent}"/>
        <circle cx="108" cy="118" r="15" fill="${accent}"/>
        <path d="M36 10 L46 10 L46 86 L36 86 Z" fill="rgba(255,255,255,.14)"/>
        <path d="M64 10 L74 10 L74 70 L64 70 Z" fill="rgba(0,0,0,.07)"/>
      </g>
      <path d="${SOCK_PATH}" fill="none" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  }

  /* ===================== SEED DATA ===================== */
  const col = (name, hex) => ({ name, hex });

  const SEED_PRODUCTS = [
    {
      id: 'p-cloud-crew', name: 'Cloud Crew', category: 'Everyday', price: 120, stock: 48,
      badge: 'Best seller', pattern: 'plain', accent: '#ffc93c', sizes: ['S', 'M', 'L'],
      description: 'Our softest everyday crew sock. Combed cotton, cushioned sole and a no-slip heel.',
      colors: [col('Snow', '#f4f1ec'), col('Midnight', '#26233a'), col('Heather', '#a7a3b5'), col('Coral', '#ff7a6b')]
    },
    {
      id: 'p-sunday-stripes', name: 'Sunday Stripes', category: 'Everyday', price: 140, stock: 36,
      badge: '', pattern: 'stripes', accent: '#ffffff', sizes: ['S', 'M', 'L'],
      description: 'Classic stripes with a relaxed fit. Looks great with sneakers and loafers alike.',
      colors: [col('Navy', '#2d3a8c'), col('Forest', '#2f7d5b'), col('Tomato', '#e5513f')]
    },
    {
      id: 'p-ankle-trio', name: 'Ankle Trio Pack', category: 'Everyday', price: 320, stock: 22,
      badge: 'Value pack', pattern: 'bands', accent: '#26233a', sizes: ['M', 'L'],
      description: 'Three pairs of breathable no-show ankle socks. The only pack you will need this year.',
      colors: [col('White', '#fbfaf7'), col('Sand', '#e2cfae'), col('Sky', '#9ccfe8')]
    },
    {
      id: 'p-sprint-ankle', name: 'Sprint Ankle', category: 'Sport', price: 150, stock: 40,
      badge: 'New', pattern: 'bands', accent: '#ffffff', sizes: ['S', 'M', 'L'],
      description: 'Lightweight, moisture-wicking and blister-resistant. Built for tempo runs and gym days.',
      colors: [col('Volt', '#b7e22e'), col('Ink', '#1f1b2e'), col('Flame', '#ff5d4d')]
    },
    {
      id: 'p-marathon-cushion', name: 'Marathon Cushion', category: 'Sport', price: 180, stock: 8,
      badge: '', pattern: 'stripes', accent: '#26233a', sizes: ['M', 'L'],
      description: 'Targeted cushioning under the heel and ball of the foot for long miles.',
      colors: [col('Aqua', '#3cc5d8'), col('Graphite', '#55536a'), col('Lilac', '#a994f5')]
    },
    {
      id: 'p-fireside-wool', name: 'Fireside Wool', category: 'Cozy', price: 220, stock: 30,
      badge: 'Winter pick', pattern: 'plain', accent: '#ff5d4d', sizes: ['S', 'M', 'L'],
      description: 'Thick merino blend that keeps toes toasty on the coldest evenings.',
      colors: [col('Oat', '#e9dcc3'), col('Moss', '#6f8a4a'), col('Plum', '#6d3b6b')]
    },
    {
      id: 'p-cabin-fleece', name: 'Cabin Fleece', category: 'Cozy', price: 250, stock: 18,
      badge: '', pattern: 'dots', accent: '#ffffff', sizes: ['S', 'M', 'L'],
      description: 'Plush fleece-lined lounge socks with grippy dots, made for slow Sunday mornings.',
      colors: [col('Blush', '#f6b8c0'), col('Slate', '#6b7a8f'), col('Cream', '#f5ecd9')]
    },
    {
      id: 'p-boardroom-merino', name: 'Boardroom Merino', category: 'Dress', price: 260, stock: 25,
      badge: '', pattern: 'bands', accent: '#ffc93c', sizes: ['M', 'L'],
      description: 'Fine-gauge merino dress sock with a seamless toe. Smooth under any shoe.',
      colors: [col('Charcoal', '#3a3848'), col('Burgundy', '#7b2a3d'), col('Deep Blue', '#1f3a68')]
    },
    {
      id: 'p-oxford-ribbed', name: 'Oxford Ribbed', category: 'Dress', price: 200, stock: 0,
      badge: '', pattern: 'plain', accent: '#d9d4e8', sizes: ['S', 'M', 'L'],
      description: 'Ribbed mid-calf dress sock that stays up all day without squeezing.',
      colors: [col('Black', '#1b1a24'), col('Brown', '#6a4a34'), col('Olive', '#5f6b3c')]
    },
    {
      id: 'p-polka-party', name: 'Polka Party', category: 'Fun', price: 130, stock: 44,
      badge: 'Fan favorite', pattern: 'dots', accent: '#ffffff', sizes: ['S', 'M', 'L'],
      description: 'Big, bold dots for people who like their outfit to start with the socks.',
      colors: [col('Pink', '#ff6fa5'), col('Teal', '#1fb5a6'), col('Sunny', '#ffc93c'), col('Violet', '#7a63e8')]
    },
    {
      id: 'p-banana-split', name: 'Banana Split', category: 'Fun', price: 135, stock: 27,
      badge: 'New', pattern: 'stripes', accent: '#ff6fa5', sizes: ['S', 'M', 'L'],
      description: 'Sweet candy stripes in a cheerful colorway. Guaranteed to get compliments.',
      colors: [col('Banana', '#ffd84d'), col('Mint', '#8be0c3'), col('Sky', '#8fc6ff')]
    },
    {
      id: 'p-midnight-galaxy', name: 'Midnight Galaxy', category: 'Fun', price: 145, stock: 6,
      badge: '', pattern: 'dots', accent: '#ffe27a', sizes: ['M', 'L'],
      description: 'Deep space colors with scattered starlight dots. Out of this world comfort.',
      colors: [col('Nebula', '#2b2468'), col('Cosmos', '#41206b'), col('Void', '#14121f')]
    },

    /* ---------- 10 new fun socks (150 – 300 EGP) ---------- */
    {
      id: 'p-lime-fizz', name: 'Lime Fizz', category: 'Fun', price: 150, stock: 40,
      badge: 'New', pattern: 'dots', accent: '#ffffff', sizes: ['S', 'M', 'L'],
      description: 'Zesty lime green with fizzy white bubbles. Sour on the name, sweet on the feet.',
      colors: [col('Lime', '#9be22d'), col('Key Lime', '#c8f06a'), col('Lime Soda', '#4fcf7a')]
    },
    {
      id: 'p-zesty-lime-slice', name: 'Zesty Lime Slice', category: 'Fun', price: 165, stock: 32,
      badge: '', pattern: 'stripes', accent: '#f4ffd0', sizes: ['S', 'M', 'L'],
      description: 'Citrus stripes in juicy greens, like a fresh lime wedge on your ankle.',
      colors: [col('Lime Green', '#7cd62f'), col('Deep Lime', '#2fa84f'), col('Lemon-Lime', '#d9ee3b')]
    },
    {
      id: 'p-chicken-dance', name: 'Chicken Dance', category: 'Fun', price: 180, stock: 35,
      badge: 'Fan favorite', pattern: 'dots', accent: '#e8352b', sizes: ['S', 'M', 'L'],
      description: 'Fluffy white-and-yellow chicken socks with a bright red comb on the cuff. Cluck cluck!',
      colors: [col('Hen White', '#fbf7ee'), col('Chick Yellow', '#ffd23f'), col('Rooster Orange', '#ff9a3c')]
    },
    {
      id: 'p-crispy-chicken', name: 'Crispy Chicken', category: 'Fun', price: 190, stock: 28,
      badge: 'New', pattern: 'bands', accent: '#fff1c9', sizes: ['M', 'L'],
      description: 'Golden, crunchy and impossible to resist. Fried-chicken colors for serious snack lovers.',
      colors: [col('Golden Crisp', '#d99a2b'), col('Extra Crispy', '#b86a1f'), col('Honey Glaze', '#f0b84a')]
    },
    {
      id: 'p-rubber-chicken', name: 'Rubber Chicken', category: 'Fun', price: 170, stock: 9,
      badge: '', pattern: 'stripes', accent: '#ff7a1a', sizes: ['S', 'M', 'L'],
      description: 'Bright yellow, totally silly and guaranteed to get a laugh at the office.',
      colors: [col('Squeaky Yellow', '#ffe135'), col('Egg White', '#fffaf0')]
    },
    {
      id: 'p-sea-sponge', name: 'Sea Sponge', category: 'Fun', price: 200, stock: 24,
      badge: '', pattern: 'dots', accent: '#c99a12', sizes: ['S', 'M', 'L'],
      description: 'Bright yellow and full of tiny pores, just like a real sea sponge. Soft, springy and happy.',
      colors: [col('Sponge Yellow', '#ffe44d'), col('Coral Pink', '#ff8fa3'), col('Ocean Blue', '#4fb8e8')]
    },
    {
      id: 'p-avocado-toast', name: 'Avocado Toast', category: 'Fun', price: 215, stock: 20,
      badge: '', pattern: 'dots', accent: '#8a5a2b', sizes: ['S', 'M', 'L'],
      description: 'Smashed-avocado green with a toasty crust cuff. Brunch for your feet.',
      colors: [col('Avocado', '#8fbf4a'), col('Guac', '#5f9b3a'), col('Cream Toast', '#f1deb4')]
    },
    {
      id: 'p-watermelon-wave', name: 'Watermelon Wave', category: 'Fun', price: 230, stock: 26,
      badge: 'Summer vibes', pattern: 'stripes', accent: '#2f8f4e', sizes: ['S', 'M', 'L'],
      description: 'Juicy pink stripes with green rind edges and tiny seeds. Cool, sweet and refreshing.',
      colors: [col('Watermelon', '#ff6b81'), col('Rind Green', '#44b868'), col('Pink Lemonade', '#ffb3c1')]
    },
    {
      id: 'p-taco-tuesday', name: 'Taco Tuesday', category: 'Fun', price: 250, stock: 15,
      badge: '', pattern: 'bands', accent: '#4caf50', sizes: ['M', 'L'],
      description: 'Crunchy shell yellow with lettuce and tomato bands. Happy feet any day of the week.',
      colors: [col('Taco Shell', '#f5c04a'), col('Salsa Red', '#e5483a'), col('Guacamole', '#8cc152')]
    },
    {
      id: 'p-pizza-night', name: 'Pizza Night', category: 'Fun', price: 300, stock: 12,
      badge: 'Premium', pattern: 'dots', accent: '#d63a2a', sizes: ['S', 'M', 'L'],
      description: 'Cheesy yellow base covered in pepperoni dots. Our softest, thickest fun sock, made for movie nights.',
      colors: [col('Melted Cheese', '#ffd56a'), col('Margherita', '#fff2d6'), col('Pepperoni', '#e04b3a')]
    }
  ];

  function calcTotalsFor(items) {
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const shipping = subtotal === 0 || subtotal >= CONFIG.freeShippingThreshold ? 0 : CONFIG.shippingFlat;
    return { subtotal, shipping, total: subtotal + shipping };
  }

  /* ===================== DATA ACCESS (Supabase) ===================== */
  const SB = window.SHARABATY_SUPABASE || {};
  const isConfigured = !!(SB.url && SB.anonKey && !/^YOUR_/.test(SB.url) && !/^YOUR_/.test(SB.anonKey));
  const db = isConfigured && window.supabase && window.supabase.createClient
    ? window.supabase.createClient(SB.url, SB.anonKey)
    : null;

  // In-memory copies of what is in the database (refreshed with loadProducts / loadOrders).
  let productsCache = [];
  let ordersCache = [];
  const getProducts = () => productsCache;
  const getOrders = () => ordersCache;
  const findProduct = (id) => productsCache.find((p) => p.id === id);

  const asArray = (v) => (Array.isArray(v) ? v : []);

  function errText(err) {
    const m = (err && err.message) || '';
    if (/failed to fetch|network|load failed/i.test(m)) return 'Network problem. Please check your connection and try again.';
    return m || 'Something went wrong. Please try again.';
  }

  function rowToProduct(r) {
    return {
      id: r.id, name: r.name, category: r.category, price: Number(r.price) || 0, stock: Number(r.stock) || 0,
      badge: r.badge || '', description: r.description || '', pattern: r.pattern || 'plain',
      accent: r.accent || '#ffc93c', colors: asArray(r.colors), sizes: asArray(r.sizes), images: asArray(r.images)
    };
  }
  function productToRow(p) {
    return {
      id: p.id, name: p.name, category: p.category, price: p.price, stock: p.stock, badge: p.badge || '',
      description: p.description || '', pattern: p.pattern || 'plain', accent: p.accent || '#ffc93c',
      colors: asArray(p.colors), sizes: asArray(p.sizes), images: asArray(p.images)
    };
  }
  function rowToOrder(r) {
    return {
      id: r.id, createdAt: r.created_at, customer: r.customer || {}, items: asArray(r.items),
      subtotal: Number(r.subtotal) || 0, shipping: Number(r.shipping) || 0, total: Number(r.total) || 0,
      payment: r.payment || { method: 'cod', status: 'pending' }, status: r.status
    };
  }

  async function loadProducts() {
    if (!db) throw new Error('The shop is not connected to its database yet (see config.js).');
    const { data, error } = await db.from('products').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    productsCache = data.map(rowToProduct);
    return productsCache;
  }
  async function loadOrders() {
    if (!db) throw new Error('Not connected (see config.js).');
    const { data, error } = await db.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    ordersCache = data.map(rowToOrder);
    return ordersCache;
  }

  /* ===================== MODAL / LAYER HELPERS ===================== */
  let lastFocus = null;

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    lastFocus = document.activeElement;
    el.hidden = false;
    document.body.classList.add('no-scroll');
    const focusable = el.querySelector('input:not([type=hidden]), select, textarea, button');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 30);
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = true;
    syncScrollLock();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
  }
  function syncScrollLock() {
    const modalOpen = $$('.modal-backdrop').some((m) => !m.hidden);
    const drawer = $('#cartDrawer');
    const drawerOpen = drawer && drawer.classList.contains('open');
    document.body.classList.toggle('no-scroll', modalOpen || drawerOpen);
  }

  function bindModalDismiss() {
    $$('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('mousedown', (e) => {
        if (e.target === bd) closeModal(bd.id);
      });
    });
    $$('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
  }

  /* ===================== STOREFRONT ===================== */
  function initStore(loadError) {
    const state = {
      category: 'All',
      search: '',
      sort: 'featured',
      selection: {},           // productId -> { colorIdx, size }
      cart: loadCart(),
      submitting: false
    };

    /* ---------- cart persistence ---------- */
    function loadCart() {
      const raw = storage.get(CONFIG.keys.cart, []);
      const products = getProducts();
      return (Array.isArray(raw) ? raw : []).filter((item) => {
        const p = products.find((x) => x.id === item.id);
        return p && item.qty > 0 && p.colors.some((c) => c.name === item.color) && p.sizes.includes(item.size);
      }).map((item) => {
        const p = products.find((x) => x.id === item.id);
        return Object.assign({}, item, { qty: Math.min(item.qty, Math.max(p.stock, 0)) });
      }).filter((i) => i.qty > 0);
    }
    const persistCart = () => storage.set(CONFIG.keys.cart, state.cart);

    const cartKey = (id, color, size) => `${id}|${color}|${size}`;
    const qtyInCartFor = (productId) => state.cart.filter((i) => i.id === productId).reduce((s, i) => s + i.qty, 0);

    function cartLines() {
      const products = getProducts();
      return state.cart.map((item) => {
        const product = products.find((p) => p.id === item.id);
        return product ? Object.assign({}, item, { product, lineTotal: product.price * item.qty }) : null;
      }).filter(Boolean);
    }
    function totals() {
      const lines = cartLines();
      return calcTotalsFor(lines.map((l) => ({ price: l.product.price, qty: l.qty })));
    }

    /* ---------- hero art ---------- */
    function renderHero() {
      const hero = $('#heroSocks');
      if (hero) {
        hero.innerHTML = '<div class="blob"></div>' + [
          ['#ff5d4d', '#ffc93c', 'stripes'],
          ['#2fbf9f', '#ffffff', 'dots'],
          ['#ffc93c', '#5b4bdb', 'bands']
        ].map(([m, a, p]) => `<div class="hero-sock">${sockSVG(m, a, p, 'Colorful sock')}</div>`).join('');
      }
      const story = $('#storyArt');
      if (story) {
        story.innerHTML = [
          ['#ffc93c', '#5b4bdb', 'bands'],
          ['#ff5d4d', '#ffffff', 'stripes'],
          ['#2fbf9f', '#1f1b2e', 'dots']
        ].map(([m, a, p], i) => `<div style="transform:rotate(${(i - 1) * 9}deg)">${sockSVG(m, a, p, 'Sock')}</div>`).join('');
      }
      const promo = $('#promoThreshold');
      if (promo) promo.textContent = money(CONFIG.freeShippingThreshold);
      const yr = $('#year');
      if (yr) yr.textContent = new Date().getFullYear();
    }

    /* ---------- catalog ---------- */
    function renderFilters() {
      const cats = ['All'].concat(CONFIG.categories);
      $('#categoryFilters').innerHTML = cats.map((c) =>
        `<button type="button" class="chip${state.category === c ? ' active' : ''}" data-cat="${esc(c)}" aria-pressed="${state.category === c}">${esc(c)}</button>`
      ).join('');
    }

    function getSelection(p) {
      let sel = state.selection[p.id];
      if (!sel || sel.colorIdx >= p.colors.length || !p.sizes.includes(sel.size)) {
        sel = { colorIdx: 0, size: p.sizes.includes('M') ? 'M' : p.sizes[0] };
        state.selection[p.id] = sel;
      }
      return sel;
    }

    function cardHTML(p) {
      const sel = getSelection(p);
      const color = p.colors[sel.colorIdx];
      const left = p.stock - qtyInCartFor(p.id);
      const soldOut = p.stock <= 0;
      const maxedOut = !soldOut && left <= 0;
      let stockTag = '';
      if (soldOut) stockTag = '<span class="tag out">Sold out</span>';
      else if (p.stock <= CONFIG.lowStockThreshold) stockTag = `<span class="tag low">Only ${p.stock} left</span>`;

      const imgs = productImages(p);
      const imgIdx = Math.min(sel.imgIdx || 0, Math.max(imgs.length - 1, 0));
      const media = imgs.length
        ? `<img class="product-photo" src="${imgs[imgIdx]}" alt="${esc(p.name)}">` +
          (imgs.length > 1
            ? `<div class="thumb-strip">${imgs.map((u, i) =>
                `<button type="button" class="thumb${i === imgIdx ? ' active' : ''}" data-img="${i}" aria-label="Photo ${i + 1}"><img src="${u}" alt=""></button>`).join('')}</div>`
            : '')
        : sockSVG(color.hex, p.accent, p.pattern, p.name + ' in ' + color.name);

      return `
      <article class="product-card" data-id="${esc(p.id)}">
        <div class="product-media${imgs.length ? ' has-photo' : ''}"${imgs.length ? '' : ` style="background:${tint(color.hex, 0.82)}"`}>
          ${p.badge ? `<span class="tag">${esc(p.badge)}</span>` : ''}
          ${stockTag}
          ${media}
        </div>
        <div class="product-body">
          <div class="product-cat">${esc(p.category)}</div>
          <h3>${esc(p.name)}</h3>
          <p class="product-desc">${esc(p.description)}</p>
          <div class="option-row">
            <span class="option-label">Color: <b>${esc(color.name)}</b></span>
            <div class="swatches" role="group" aria-label="Color">
              ${p.colors.map((c, i) => `<button type="button" class="swatch${i === sel.colorIdx ? ' active' : ''}" data-color="${i}" style="background:${esc(c.hex)}" title="${esc(c.name)}" aria-label="${esc(c.name)}" aria-pressed="${i === sel.colorIdx}"></button>`).join('')}
            </div>
          </div>
          <div class="option-row">
            <span class="option-label">Size</span>
            <div class="sizes" role="group" aria-label="Size">
              ${p.sizes.map((s) => `<button type="button" class="size-btn${s === sel.size ? ' active' : ''}" data-size="${esc(s)}" aria-pressed="${s === sel.size}">${esc(s)}</button>`).join('')}
            </div>
          </div>
          <div class="card-foot">
            <span class="price">${money(p.price)}</span>
            <button type="button" class="btn btn-primary btn-sm" data-add ${soldOut || maxedOut ? 'disabled' : ''}>
              ${soldOut ? 'Sold out' : maxedOut ? 'Max in cart' : 'Add to cart'}
            </button>
          </div>
        </div>
      </article>`;
    }

    function visibleProducts() {
      const q = state.search.trim().toLowerCase();
      let list = getProducts().filter((p) =>
        (state.category === 'All' || p.category === state.category) &&
        (!q || (p.name + ' ' + p.description + ' ' + p.category).toLowerCase().includes(q))
      );
      if (state.sort === 'price-asc') list = list.slice().sort((a, b) => a.price - b.price);
      else if (state.sort === 'price-desc') list = list.slice().sort((a, b) => b.price - a.price);
      else if (state.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
      return list;
    }

    function renderProducts() {
      const list = visibleProducts();
      $('#productGrid').innerHTML = list.map(cardHTML).join('');
      $('#emptyState').hidden = list.length > 0;
    }

    function refreshCard(id) {
      const p = findProduct(id);
      const el = $(`.product-card[data-id="${CSS.escape(id)}"]`);
      if (p && el) el.outerHTML = cardHTML(p);
    }

    /* ---------- cart UI ---------- */
    function renderCart() {
      const lines = cartLines();
      const t = totals();
      const count = lines.reduce((s, l) => s + l.qty, 0);
      $('#cartCount').textContent = count;
      $('#cartCount').hidden = count === 0;

      const body = $('#cartItems');
      if (!lines.length) {
        body.innerHTML = `<div class="cart-empty"><div class="big">🧦</div><h3>Your cart is empty</h3><p>Find a pair you love and add it here.</p></div>`;
      } else {
        body.innerHTML = lines.map((l) => {
          const color = l.product.colors.find((c) => c.name === l.color) || l.product.colors[0];
          const key = cartKey(l.id, l.color, l.size);
          const canInc = qtyInCartFor(l.id) < l.product.stock;
          return `
          <div class="cart-item">
            <div class="cart-thumb" style="background:${tint(color.hex, 0.8)}">${thumbHTML(l.product, color.hex)}</div>
            <div>
              <h4>${esc(l.product.name)}</h4>
              <div class="cart-meta">${esc(l.color)} · Size ${esc(l.size)} · ${money(l.product.price)}</div>
              <div class="qty" role="group" aria-label="Quantity">
                <button type="button" data-act="dec" data-key="${esc(key)}" aria-label="Decrease quantity">−</button>
                <span aria-live="polite">${l.qty}</span>
                <button type="button" data-act="inc" data-key="${esc(key)}" aria-label="Increase quantity" ${canInc ? '' : 'disabled'}>+</button>
              </div>
            </div>
            <div class="cart-line-right">
              <b>${money(l.lineTotal)}</b>
              <button type="button" class="link-btn" data-act="remove" data-key="${esc(key)}">Remove</button>
            </div>
          </div>`;
        }).join('');
      }

      $('#cartSubtotal').textContent = money(t.subtotal);
      $('#cartShipping').textContent = t.shipping === 0 ? (t.subtotal ? 'Free' : '—') : money(t.shipping);
      $('#cartTotal').textContent = money(t.total);
      $('#checkoutBtn').disabled = lines.length === 0;

      // free-shipping progress
      const pct = Math.min(100, Math.round((t.subtotal / CONFIG.freeShippingThreshold) * 100));
      $('#shipFill').style.width = pct + '%';
      $('#shipMsg').textContent = t.subtotal === 0
        ? `Free delivery on orders over ${money(CONFIG.freeShippingThreshold)}`
        : t.subtotal >= CONFIG.freeShippingThreshold
          ? '🎉 You unlocked free delivery!'
          : `Add ${money(CONFIG.freeShippingThreshold - t.subtotal)} more for free delivery`;
    }

    function addToCart(productId) {
      const p = findProduct(productId);
      if (!p) return;
      const sel = getSelection(p);
      const color = p.colors[sel.colorIdx];
      if (p.stock <= 0) { toast('Sorry, that one is sold out.', 'error'); return; }
      if (qtyInCartFor(p.id) >= p.stock) { toast(`Only ${p.stock} in stock.`, 'error'); return; }
      const key = cartKey(p.id, color.name, sel.size);
      const existing = state.cart.find((i) => cartKey(i.id, i.color, i.size) === key);
      if (existing) existing.qty += 1;
      else state.cart.push({ id: p.id, color: color.name, size: sel.size, qty: 1 });
      persistCart();
      renderCart();
      refreshCard(p.id);
      toast(`Added ${p.name} (${color.name}, ${sel.size}) to cart`, 'success');
    }

    function changeQty(key, delta) {
      const item = state.cart.find((i) => cartKey(i.id, i.color, i.size) === key);
      if (!item) return;
      const p = findProduct(item.id);
      if (delta > 0 && (!p || qtyInCartFor(item.id) >= p.stock)) { toast('No more stock available.', 'error'); return; }
      item.qty += delta;
      if (item.qty <= 0) state.cart = state.cart.filter((i) => i !== item);
      persistCart();
      renderCart();
      refreshCard(item.id);
    }
    function removeItem(key) {
      const item = state.cart.find((i) => cartKey(i.id, i.color, i.size) === key);
      state.cart = state.cart.filter((i) => cartKey(i.id, i.color, i.size) !== key);
      persistCart();
      renderCart();
      if (item) refreshCard(item.id);
    }

    function openCart() {
      lastFocus = document.activeElement;
      $('#cartOverlay').classList.add('open');
      const d = $('#cartDrawer');
      d.classList.add('open');
      d.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      setTimeout(() => $('#closeCart').focus({ preventScroll: true }), 50);
    }
    function closeCart(restoreFocus) {
      $('#cartOverlay').classList.remove('open');
      const d = $('#cartDrawer');
      d.classList.remove('open');
      d.setAttribute('aria-hidden', 'true');
      syncScrollLock();
      if (restoreFocus !== false && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }

    /* ---------- checkout ---------- */
    function renderSummary() {
      const lines = cartLines();
      const t = totals();
      $('#summaryItems').innerHTML = lines.map((l) => `
        <div class="sum-item">
          <div>${l.qty} × ${esc(l.product.name)}<small>${esc(l.color)} · Size ${esc(l.size)}</small></div>
          <b>${money(l.lineTotal)}</b>
        </div>`).join('');
      $('#sumSubtotal').textContent = money(t.subtotal);
      $('#sumShipping').textContent = t.shipping === 0 ? 'Free' : money(t.shipping);
      $('#sumTotal').textContent = money(t.total);
    }

    function selectedPayment() {
      const r = $('input[name="payment"]:checked');
      return r ? r.value : 'cod';
    }
    function togglePaymentUI() {
      const isCard = selectedPayment() === 'card';
      $('#cardFields').hidden = !isCard;
      $('#placeOrderBtn').textContent = isCard ? 'Pay & place order' : 'Place order (pay on delivery)';
    }

    function openCheckout() {
      if (!state.cart.length) return;
      closeCart(false);
      resetCheckoutForm();
      renderSummary();
      togglePaymentUI();
      $('#checkoutView').hidden = false;
      $('#confirmView').hidden = true;
      $('#checkoutTitle').textContent = 'Checkout';
      openModal('checkoutModal');
    }

    function resetCheckoutForm() {
      clearErrors();
      $('#placeOrderBtn').disabled = false;
    }

    function clearErrors() {
      $$('[data-error-for]').forEach((el) => { el.textContent = ''; el.closest('.field').classList.remove('has-error'); });
      const fe = $('#formError');
      fe.hidden = true;
      fe.textContent = '';
    }
    function setError(fieldId, message) {
      const el = $(`[data-error-for="${fieldId}"]`);
      if (!el) return;
      el.textContent = message;
      el.closest('.field').classList.add('has-error');
    }

    function luhn(digits) {
      let sum = 0;
      let alt = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
      }
      return digits.length > 0 && sum % 10 === 0;
    }

    function readForm() {
      return {
        name: $('#fullName').value.trim(),
        phone: $('#phone').value.trim(),
        address: $('#address').value.trim(),
        city: $('#city').value.trim(),
        notes: $('#notes').value.trim(),
        payment: selectedPayment(),
        card: {
          name: $('#cardName').value.trim(),
          number: $('#cardNumber').value.replace(/\D/g, ''),
          expiry: $('#cardExpiry').value.trim(),
          cvc: $('#cardCvc').value.trim()
        }
      };
    }

    function validate(f) {
      const errors = {};
      if (f.name.length < 2) errors.fullName = 'Please enter your full name.';
      const phoneDigits = f.phone.replace(/\D/g, '');
      if (!/^\+?[\d\s\-()]+$/.test(f.phone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
        errors.phone = 'Enter a valid phone number (8–15 digits).';
      }
      if (f.address.length < 6) errors.address = 'Please enter your full delivery address.';
      if (f.city.length < 2) errors.city = 'Please enter your city.';

      if (f.payment === 'card') {
        if (f.card.name.length < 2) errors.cardName = 'Enter the name on the card.';
        if (f.card.number.length < 13 || f.card.number.length > 19 || !luhn(f.card.number)) {
          errors.cardNumber = 'Enter a valid card number.';
        }
        const m = /^(\d{2})\/(\d{2})$/.exec(f.card.expiry);
        if (!m) {
          errors.cardExpiry = 'Use MM/YY.';
        } else {
          const month = parseInt(m[1], 10);
          const year = 2000 + parseInt(m[2], 10);
          const now = new Date();
          const expired = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
          if (month < 1 || month > 12) errors.cardExpiry = 'Invalid month.';
          else if (expired) errors.cardExpiry = 'This card has expired.';
        }
        if (!/^\d{3,4}$/.test(f.card.cvc)) errors.cardCvc = '3 or 4 digits.';
      }
      return errors;
    }

    /**
     * ------------------------------------------------------------
     * PAYMENT HOOK – replace the body of this function to go live.
     * ------------------------------------------------------------
     * Right now it simulates a gateway so the whole flow can be
     * tested. In production you should NEVER send raw card numbers
     * to your own server. Use your provider's hosted fields instead
     * (e.g. Stripe Elements / Payment Element), create a PaymentIntent
     * on your server, and call stripe.confirmPayment() here.
     * README.md contains a complete step-by-step Stripe example.
     *
     * Must resolve to:
     *   { success: true,  transactionId: string, last4: string }
     *   { success: false, error: string }
     */
    async function processCardPayment(order, card) {
      await wait(1200); // simulate network latency
      if (card.number === '4000000000000002') {
        return { success: false, error: 'Your card was declined. Please try a different card.' };
      }
      return {
        success: true,
        transactionId: 'mock_pi_' + Math.random().toString(36).slice(2, 12),
        last4: card.number.slice(-4)
      };
    }

    async function handlePlaceOrder(e) {
      e.preventDefault();
      if (state.submitting) return;
      clearErrors();

      const f = readForm();
      const errors = validate(f);
      const ids = Object.keys(errors);
      if (ids.length) {
        ids.forEach((id) => setError(id, errors[id]));
        const first = document.getElementById(ids[0]);
        if (first) first.focus();
        return;
      }

      // Re-check stock against the latest inventory.
      const lines = cartLines();
      if (!lines.length) { toast('Your cart is empty.', 'error'); return; }
      for (const l of lines) {
        if (l.product.stock < l.qty) {
          const fe = $('#formError');
          fe.textContent = `Sorry, only ${l.product.stock} of "${l.product.name}" left in stock. Please update your cart.`;
          fe.hidden = false;
          return;
        }
      }

      if (!db) {
        const fe = $('#formError');
        fe.textContent = 'The shop is not connected to its database yet. Please try again later.';
        fe.hidden = false;
        return;
      }

      const customer = { name: f.name, phone: f.phone, address: f.address, city: f.city, notes: f.notes };
      const items = lines.map((l) => ({ productId: l.id, color: l.color, size: l.size, qty: l.qty }));
      const payment = { method: f.payment };

      state.submitting = true;
      const btn = $('#placeOrderBtn');
      btn.disabled = true;
      btn.textContent = f.payment === 'card' ? 'Processing payment…' : 'Placing order…';

      try {
        if (f.payment === 'card') {
          const result = await processCardPayment({ customer, items, total: totals().total }, f.card);
          if (!result.success) {
            const fe = $('#formError');
            fe.textContent = result.error || 'Payment failed. Please try again.';
            fe.hidden = false;
            return;
          }
          payment.last4 = result.last4;
          payment.transactionId = result.transactionId;
        }

        // The server re-checks stock, recomputes prices and the delivery fee, and saves the order.
        const { data, error } = await db.rpc('place_order', {
          p_customer: customer, p_items: items, p_payment: payment
        });
        if (error) throw error;

        state.cart = [];
        persistCart();
        try { await loadProducts(); } catch (e) { /* stock refreshes on the next visit */ }
        renderCart();
        renderProducts();
        showConfirmation(data);
      } catch (err) {
        const fe = $('#formError');
        fe.textContent = errText(err);
        fe.hidden = false;
        try {
          await loadProducts();
          state.cart = loadCart();
          renderCart();
          renderProducts();
          renderSummary();
        } catch (e2) { /* ignore */ }
      } finally {
        state.submitting = false;
        btn.disabled = false;
        togglePaymentUI();
      }
    }

    function showConfirmation(order) {
      const isCard = order.payment.method === 'card';
      $('#checkoutTitle').textContent = 'Order placed';
      $('#checkoutView').hidden = true;
      const view = $('#confirmView');
      view.hidden = false;
      view.innerHTML = `
        <div class="confirm">
          <div class="check" aria-hidden="true">✓</div>
          <h2>Thank you, ${esc(order.customer.name.split(' ')[0])}!</h2>
          <div class="order-id">Order ${esc(order.id)}</div>
          <p>${isCard
            ? `Your payment of <b>${money(order.total)}</b> was received (card ending <b>${esc(order.payment.last4)}</b>).`
            : `Please have <b>${money(order.total)}</b> in cash ready when your order arrives.`}</p>
          <div class="confirm-box">
            <p><b>Delivering to</b></p>
            <p>${esc(order.customer.name)} · ${esc(order.customer.phone)}</p>
            <p>${esc(order.customer.address)}, ${esc(order.customer.city)}</p>
            <p style="margin-top:10px"><b>Payment</b>: ${isCard ? 'Paid by card' : 'Cash on delivery'}</p>
          </div>
          <p style="color:var(--muted);font-size:.9rem">We'll call you on your phone number to confirm delivery. Estimated delivery: 2–3 days.</p>
          <button type="button" class="btn btn-primary" id="continueShopping">Continue shopping</button>
        </div>`;
      $('#continueShopping').addEventListener('click', () => {
        closeModal('checkoutModal');
        $('#checkoutForm').reset();
        document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
      });
      $('#continueShopping').focus();
    }

    /* ---------- events ---------- */
    $('#categoryFilters').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      state.category = btn.dataset.cat;
      renderFilters();
      renderProducts();
    });
    $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderProducts(); });
    $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; renderProducts(); });

    $('#productGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.product-card');
      if (!card) return;
      const id = card.dataset.id;
      const p = findProduct(id);
      if (!p) return;
      const swatch = e.target.closest('[data-color]');
      const sizeBtn = e.target.closest('[data-size]');
      const imgBtn = e.target.closest('[data-img]');
      const add = e.target.closest('[data-add]');
      if (imgBtn) { getSelection(p).imgIdx = parseInt(imgBtn.dataset.img, 10); refreshCard(id); }
      else if (swatch) { getSelection(p).colorIdx = parseInt(swatch.dataset.color, 10); refreshCard(id); }
      else if (sizeBtn) { getSelection(p).size = sizeBtn.dataset.size; refreshCard(id); }
      else if (add) addToCart(id);
    });

    $('#cartItems').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const key = btn.dataset.key;
      if (btn.dataset.act === 'inc') changeQty(key, 1);
      else if (btn.dataset.act === 'dec') changeQty(key, -1);
      else if (btn.dataset.act === 'remove') removeItem(key);
    });

    $('#openCart').addEventListener('click', openCart);
    $('#closeCart').addEventListener('click', () => closeCart());
    $('#cartOverlay').addEventListener('click', () => closeCart());
    $('#checkoutBtn').addEventListener('click', openCheckout);
    $('#closeCheckout').addEventListener('click', () => closeModal('checkoutModal'));

    $$('input[name="payment"]').forEach((r) => r.addEventListener('change', togglePaymentUI));
    $('#checkoutForm').addEventListener('submit', handlePlaceOrder);

    // input masks
    $('#cardNumber').addEventListener('input', (e) => {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 19);
      e.target.value = digits.replace(/(.{4})/g, '$1 ').trim();
    });
    $('#cardExpiry').addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
      e.target.value = v;
    });
    $('#cardCvc').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

    // mobile menu
    const menuToggle = $('#menuToggle');
    menuToggle.addEventListener('click', () => {
      const nav = $('#mainNav');
      const open = nav.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', String(open));
    });
    $$('#mainNav a').forEach((a) => a.addEventListener('click', () => {
      $('#mainNav').classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
    }));

    // Esc closes the top-most layer
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = $$('.modal-backdrop').find((m) => !m.hidden);
      if (modal) closeModal(modal.id);
      else if ($('#cartDrawer').classList.contains('open')) closeCart();
    });

    // Refresh prices and stock when the customer comes back to this tab
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden || state.submitting) return;
      try {
        await loadProducts();
        state.cart = loadCart();
        renderProducts();
        renderCart();
      } catch (e) { /* keep showing what we already have */ }
    });

    // Card payments stay hidden until a real gateway is connected.
    if (!CONFIG.cardPaymentsEnabled) {
      const cardRadio = $('input[name="payment"][value="card"]');
      if (cardRadio) cardRadio.closest('.pay-option').hidden = true;
      const cod = $('input[name="payment"][value="cod"]');
      if (cod) cod.checked = true;
    }

    bindModalDismiss();
    renderHero();
    renderFilters();
    renderProducts();
    renderCart();
    togglePaymentUI();

    if (loadError) {
      console.error(loadError);
      $('#emptyState').hidden = true;
      $('#productGrid').innerHTML =
        '<div class="empty-state" style="grid-column:1/-1"><div class="big">🔌</div>' +
        '<h3>We couldn\'t load the socks</h3><p>Please refresh the page in a moment.</p></div>';
    }
  }

  /* ===================== ADMIN ===================== */
  function initAdmin() {
    const state = { tab: 'orders' };

    /* ---------- auth (Supabase Auth) ---------- */
    async function loadAll() {
      try {
        await Promise.all([loadProducts(), loadOrders()]);
        renderAll();
      } catch (err) {
        toast('Could not load data: ' + errText(err), 'error');
      }
    }

    async function showAuthState(message) {
      let authed = false;
      let note = message || '';
      if (db) {
        try {
          const { data } = await db.auth.getSession();
          if (data && data.session) {
            const { data: isAdm, error } = await db.rpc('is_admin');
            authed = !error && isAdm === true;
            if (!authed) {
              await db.auth.signOut();
              note = note || 'This account is not an admin.';
            }
          }
        } catch (e) { /* treat as signed out */ }
      } else {
        note = note || 'Not connected: add your Supabase URL and key in config.js.';
      }
      $('#loginView').hidden = authed;
      $('#dashboard').hidden = !authed;
      $('#loginError').textContent = authed ? '' : note;
      if (authed) await loadAll();
    }

    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#loginError');
      errEl.textContent = '';
      if (!db) { await showAuthState(); return; }
      const btn = $('#loginBtn');
      btn.disabled = true;
      try {
        const { error } = await db.auth.signInWithPassword({
          email: $('#loginEmail').value.trim(),
          password: $('#passcode').value
        });
        if (error) {
          errEl.textContent = 'Incorrect email or password.';
          $('#passcode').closest('.field').classList.add('has-error');
          return;
        }
        $('#passcode').value = '';
        $('#passcode').closest('.field').classList.remove('has-error');
        await showAuthState();
      } finally {
        btn.disabled = false;
      }
    });
    $('#logoutBtn').addEventListener('click', async () => {
      if (db) await db.auth.signOut();
      await showAuthState();
    });

    /* ---------- labels ---------- */
    const STATUS_LABELS = { pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
    const statusPill = (s) => {
      const cls = { pending: 'warn', confirmed: 'card', shipped: 'card', delivered: 'ok', cancelled: 'bad' }[s] || 'neutral';
      return `<span class="pill ${cls}">${esc(STATUS_LABELS[s] || s)}</span>`;
    };
    function paymentPill(order) {
      const m = order.payment.method;
      return m === 'card'
        ? '<span class="pill card">💳 Card</span>'
        : '<span class="pill cod">💵 Cash on delivery</span>';
    }
    function paymentStateText(order) {
      if (order.payment.method === 'card') {
        return order.payment.status === 'paid'
          ? `Paid · ••${esc(order.payment.last4 || '')}`
          : esc(order.payment.status);
      }
      return order.payment.status === 'paid' ? 'Cash collected' : 'Collect on delivery';
    }

    /* ---------- stats ---------- */
    function renderStats() {
      const orders = getOrders();
      const active = orders.filter((o) => o.status !== 'cancelled');
      const revenue = active.reduce((s, o) => s + o.total, 0);
      const cod = active.filter((o) => o.payment.method === 'cod').length;
      const card = active.filter((o) => o.payment.method === 'card').length;
      const low = getProducts().filter((p) => p.stock <= CONFIG.lowStockThreshold).length;
      $('#stats').innerHTML = `
        <div class="stat"><span>Orders</span><b>${orders.length}</b></div>
        <div class="stat"><span>Revenue</span><b>${money(revenue)}</b></div>
        <div class="stat"><span>Cash on delivery</span><b>${cod}</b></div>
        <div class="stat"><span>Card orders</span><b>${card}</b></div>
        <div class="stat"><span>Low / out of stock</span><b>${low}</b></div>`;
    }

    /* ---------- orders ---------- */
    function filteredOrders() {
      const q = $('#orderSearch').value.trim().toLowerCase();
      const pay = $('#orderPayFilter').value;
      const st = $('#orderStatusFilter').value;
      return getOrders().filter((o) =>
        (pay === 'all' || o.payment.method === pay) &&
        (st === 'all' || o.status === st) &&
        (!q || (o.id + ' ' + o.customer.name + ' ' + o.customer.phone + ' ' + o.customer.city).toLowerCase().includes(q))
      );
    }

    function renderOrders() {
      const list = filteredOrders();
      const body = $('#ordersBody');
      if (!list.length) {
        body.innerHTML = '<tr class="empty-row"><td colspan="7">No orders match your filters.</td></tr>';
        return;
      }
      body.innerHTML = list.map((o) => `
        <tr data-order="${esc(o.id)}">
          <td><b>${esc(o.id)}</b><span class="sub">${esc(fmtDate(o.createdAt))}</span></td>
          <td>${esc(o.customer.name)}<span class="sub">${esc(o.customer.phone)}</span></td>
          <td class="addr">${esc(o.customer.address)}<span class="sub">${esc(o.customer.city)}</span></td>
          <td>${paymentPill(o)}<span class="sub">${paymentStateText(o)}</span></td>
          <td class="num"><b>${money(o.total)}</b><span class="sub">${o.items.reduce((s, i) => s + i.qty, 0)} items</span></td>
          <td>
            <select class="status-select" data-status-for="${esc(o.id)}" aria-label="Status for order ${esc(o.id)}">
              ${Object.keys(STATUS_LABELS).map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select>
          </td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-view-order="${esc(o.id)}">Details</button></td>
        </tr>`).join('');
    }

    async function setOrderStatus(id, status) {
      const o = getOrders().find((x) => x.id === id);
      if (!o || o.status === status) return;
      // The database does this in one step: it also returns the socks to stock when an order is cancelled.
      const { error } = await db.rpc('admin_set_order_status', { p_id: id, p_status: status });
      if (error) {
        toast('Could not update the order: ' + errText(error), 'error');
      } else {
        toast(`Order ${id} → ${STATUS_LABELS[status]}`, 'success');
      }
      await loadAll();
    }

    function showOrder(id) {
      const o = getOrders().find((x) => x.id === id);
      if (!o) return;
      $('#orderModalTitle').textContent = 'Order ' + o.id;
      $('#orderModalBody').innerHTML = `
        <div class="detail-grid">
          <div class="detail-box">
            <h4>Customer</h4>
            <p><b>${esc(o.customer.name)}</b></p>
            <p>📞 ${esc(o.customer.phone)}</p>
            <p>📍 ${esc(o.customer.address)}, ${esc(o.customer.city)}</p>
            ${o.customer.notes ? `<p>📝 ${esc(o.customer.notes)}</p>` : ''}
          </div>
          <div class="detail-box">
            <h4>Payment</h4>
            <p>${paymentPill(o)}</p>
            <p>${paymentStateText(o)}</p>
            ${o.payment.transactionId ? `<p style="color:var(--muted);font-size:.8rem">Ref: ${esc(o.payment.transactionId)}</p>` : ''}
            <p style="margin-top:8px">${statusPill(o.status)} <span style="color:var(--muted);font-size:.8rem">${esc(fmtDate(o.createdAt))}</span></p>
          </div>
        </div>
        <div class="table-wrap"><table style="min-width:0">
          <thead><tr><th>Item</th><th>Variant</th><th class="num">Qty</th><th class="num">Price</th></tr></thead>
          <tbody>
            ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.color)} · ${esc(i.size)}</td><td class="num">${i.qty}</td><td class="num">${money(i.price * i.qty)}</td></tr>`).join('')}
          </tbody>
        </table></div>
        <div style="margin-top:16px;max-width:260px;margin-left:auto">
          <div class="sum-row"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
          <div class="sum-row"><span>Delivery</span><span>${o.shipping ? money(o.shipping) : 'Free'}</span></div>
          <div class="sum-row total" style="margin-bottom:0"><span>Total</span><span>${money(o.total)}</span></div>
        </div>`;
      openModal('orderModal');
    }

    function exportCsv() {
      const rows = [['Order ID', 'Date', 'Customer', 'Phone', 'Address', 'City', 'Payment method', 'Payment status', 'Items', 'Total', 'Status']];
      filteredOrders().forEach((o) => {
        rows.push([
          o.id, o.createdAt, o.customer.name, o.customer.phone, o.customer.address, o.customer.city,
          o.payment.method === 'card' ? 'Card' : 'Cash on delivery', o.payment.status,
          o.items.map((i) => `${i.qty}x ${i.name} (${i.color}/${i.size})`).join('; '), o.total, o.status
        ]);
      });
      const csv = rows.map((r) => r.map((cell) => {
        let s = String(cell == null ? '' : cell);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(',')).join('\r\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sharabaty-orders.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    /* ---------- inventory ---------- */
    function stockPill(stock) {
      if (stock <= 0) return '<span class="pill bad">Out of stock</span>';
      if (stock <= CONFIG.lowStockThreshold) return '<span class="pill warn">Low stock</span>';
      return '<span class="pill ok">In stock</span>';
    }

    function renderInventory() {
      const q = $('#invSearch').value.trim().toLowerCase();
      const list = getProducts().filter((p) => !q || (p.name + ' ' + p.category).toLowerCase().includes(q));
      const body = $('#inventoryBody');
      if (!list.length) { body.innerHTML = '<tr class="empty-row"><td colspan="5">No products found.</td></tr>'; return; }
      body.innerHTML = list.map((p) => `
        <tr data-row="${esc(p.id)}">
          <td><div class="prod-cell">
            <div class="mini-thumb" style="background:${tint(p.colors[0].hex, 0.8)}">${thumbHTML(p, p.colors[0].hex)}</div>
            <div><b>${esc(p.name)}</b></div></div></td>
          <td>${esc(p.category)}</td>
          <td class="num">${money(p.price)}</td>
          <td><div class="stock-ctl">
            <button type="button" data-step="-1" data-id="${esc(p.id)}" aria-label="Decrease stock of ${esc(p.name)}">−</button>
            <input type="number" min="0" step="1" value="${p.stock}" data-stock-input="${esc(p.id)}" aria-label="Stock of ${esc(p.name)}">
            <button type="button" data-step="1" data-id="${esc(p.id)}" aria-label="Increase stock of ${esc(p.name)}">+</button>
          </div></td>
          <td class="stock-status">${stockPill(p.stock)}</td>
        </tr>`).join('');
    }

    function applyStockToUI(id, stock) {
      const p = findProduct(id);
      if (p) p.stock = stock;
      const row = $(`tr[data-row="${CSS.escape(id)}"]`);
      if (row) {
        $('input', row).value = stock;
        $('.stock-status', row).innerHTML = stockPill(stock);
      }
      renderStats();
    }

    // "+" / "−" buttons: the database adds or subtracts, so a sale that happened
    // while this page was open is never overwritten.
    async function adjustStock(id, delta) {
      const { data, error } = await db.rpc('admin_adjust_stock', { p_id: id, p_delta: delta });
      if (error) { toast('Could not save stock: ' + errText(error), 'error'); return; }
      applyStockToUI(id, Number(data));
    }

    // Typing an exact number in the box.
    async function setStock(id, value) {
      const n = Math.max(0, Math.floor(Number(value)));
      const stock = Number.isFinite(n) ? n : 0;
      const { error } = await db.from('products').update({ stock }).eq('id', id);
      if (error) { toast('Could not save stock: ' + errText(error), 'error'); await loadAll(); return; }
      applyStockToUI(id, stock);
    }

    /* ---------- products ---------- */
    function renderProducts() {
      const list = getProducts();
      $('#importSeedBtn').hidden = list.length > 0;
      const body = $('#productsBody');
      if (!list.length) { body.innerHTML = '<tr class="empty-row"><td colspan="7">No products yet. Add your first one, or import the starter socks.</td></tr>'; return; }
      body.innerHTML = list.map((p) => `
        <tr>
          <td><div class="prod-cell">
            <div class="mini-thumb" style="background:${tint(p.colors[0].hex, 0.8)}">${thumbHTML(p, p.colors[0].hex)}</div>
            <div><b>${esc(p.name)}</b>${p.badge ? `<span class="sub">${esc(p.badge)}</span>` : ''}</div></div></td>
          <td>${esc(p.category)}</td>
          <td><div class="dots">${p.colors.map((c) => `<i style="background:${esc(c.hex)}" title="${esc(c.name)}"></i>`).join('')}</div></td>
          <td>${p.sizes.map(esc).join(', ')}</td>
          <td class="num">${money(p.price)}</td>
          <td class="num">${p.stock}</td>
          <td><div class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" data-delete="${esc(p.id)}">Delete</button>
          </div></td>
        </tr>`).join('');
    }

    let formImages = [];

    function renderImagePreview() {
      const box = $('#pImagePreview');
      if (!formImages.length) {
        box.innerHTML = '<p class="img-empty">No photos yet. The colored sock illustration is shown instead.</p>';
        return;
      }
      box.innerHTML = formImages.map((u, i) =>
        `<div class="img-prev"><img src="${u}" alt="Photo ${i + 1}">` +
        `<button type="button" data-rm-img="${i}" aria-label="Remove photo ${i + 1}">✕</button>` +
        (i === 0 ? '<span class="img-main">Main</span>' : '') + '</div>').join('');
    }

    async function uploadPhoto(dataUrl) {
      const blob = await (await fetch(dataUrl)).blob();
      const path = 'p/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
      const { error } = await db.storage.from('product-images').upload(path, blob, {
        contentType: 'image/jpeg', cacheControl: '31536000'
      });
      if (error) throw error;
      return db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    }

    async function addPhotos(fileList) {
      const files = Array.from(fileList);
      for (const file of files) {
        if (formImages.length >= MAX_PHOTOS) { toast(`Maximum ${MAX_PHOTOS} photos per product.`, 'error'); break; }
        try {
          const dataUrl = await fileToResizedDataURL(file, 800, 0.82);
          formImages.push(await uploadPhoto(dataUrl));
        } catch (err) {
          toast(`${file.name}: ${errText(err)}`, 'error');
        }
      }
      renderImagePreview();
    }

    function fillProductForm(p) {
      $('#pCategory').innerHTML = CONFIG.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      $('#pSizes').innerHTML = CONFIG.sizes.map((s) =>
        `<label><input type="checkbox" name="sizes" value="${esc(s)}"> ${esc(s)}</label>`).join('');
      const data = p || {
        id: '', name: '', category: CONFIG.categories[0], price: '', stock: '', badge: '', description: '',
        pattern: 'plain', accent: '#ffc93c', colors: [], sizes: ['S', 'M', 'L']
      };
      $('#pId').value = data.id;
      $('#pName').value = data.name;
      $('#pCategory').value = data.category;
      $('#pBadge').value = data.badge || '';
      $('#pPrice').value = data.price;
      $('#pStock').value = data.stock;
      $('#pDesc').value = data.description || '';
      $('#pPattern').value = data.pattern || 'plain';
      $('#pAccent').value = data.accent || '#ffc93c';
      $('#pColors').value = data.colors.map((c) => `${c.name}:${c.hex}`).join(', ');
      $$('input[name="sizes"]', $('#pSizes')).forEach((cb) => { cb.checked = data.sizes.includes(cb.value); });
      formImages = productImages(data).slice(0, MAX_PHOTOS);
      $('#pImages').value = '';
      renderImagePreview();
      const fe = $('#productFormError');
      fe.hidden = true;
      fe.textContent = '';
    }

    function openProductForm(id) {
      const p = id ? findProduct(id) : null;
      fillProductForm(p);
      $('#productModalTitle').textContent = p ? 'Edit product' : 'Add product';
      openModal('productModal');
    }

    function parseColors(text) {
      const colors = [];
      for (const part of text.split(',')) {
        const piece = part.trim();
        if (!piece) continue;
        const idx = piece.lastIndexOf(':');
        if (idx < 1) return { error: `"${piece}" should look like Name:#hex` };
        const name = piece.slice(0, idx).trim();
        let hex = piece.slice(idx + 1).trim();
        if (!hex.startsWith('#')) hex = '#' + hex;
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return { error: `"${hex}" is not a valid 6-digit hex color.` };
        if (colors.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { error: `Duplicate color name "${name}".` };
        colors.push({ name, hex: hex.toLowerCase() });
      }
      if (!colors.length) return { error: 'Add at least one color (e.g. Snow:#f4f1ec).' };
      return { colors };
    }

    async function saveProductForm(e) {
      e.preventDefault();
      const fe = $('#productFormError');
      const fail = (msg) => { fe.textContent = msg; fe.hidden = false; };
      const name = $('#pName').value.trim();
      const price = parseFloat($('#pPrice').value);
      const stock = parseInt($('#pStock').value, 10);
      const sizes = $$('input[name="sizes"]:checked', $('#pSizes')).map((cb) => cb.value);
      if (name.length < 2) return fail('Please enter a product name.');
      if (!Number.isFinite(price) || price < 0) return fail('Please enter a valid price.');
      if (!Number.isInteger(stock) || stock < 0) return fail('Stock must be a whole number (0 or more).');
      if (!sizes.length) return fail('Select at least one size.');
      const parsed = parseColors($('#pColors').value);
      if (parsed.error) return fail(parsed.error);

      const id = $('#pId').value;
      const record = {
        id: id || 'p' + Date.now().toString(36),
        name,
        category: $('#pCategory').value,
        price: Math.round(price * 100) / 100,
        stock,
        badge: $('#pBadge').value.trim(),
        description: $('#pDesc').value.trim(),
        pattern: $('#pPattern').value,
        accent: $('#pAccent').value,
        colors: parsed.colors,
        sizes,
        images: formImages.slice()
      };

      const submitBtn = $('button[type="submit"]', $('#productForm'));
      submitBtn.disabled = true;
      try {
        const { error } = await db.from('products').upsert(productToRow(record));
        if (error) return fail('Could not save: ' + errText(error));
        closeModal('productModal');
        toast(id ? 'Product updated' : 'Product added', 'success');
        await loadAll();
      } finally {
        submitBtn.disabled = false;
      }
    }

    async function deleteProduct(id) {
      const p = findProduct(id);
      if (!p) return;
      if (!window.confirm(`Delete "${p.name}"? Existing orders keep their history.`)) return;
      const { error } = await db.from('products').delete().eq('id', id);
      if (error) { toast('Could not delete: ' + errText(error), 'error'); return; }
      toast('Product deleted');
      await loadAll();
    }

    async function importStarterProducts() {
      if (!window.confirm(`Add the ${SEED_PRODUCTS.length} starter socks to your shop? You can edit or delete them afterwards.`)) return;
      const { error } = await db.from('products').upsert(SEED_PRODUCTS.map(productToRow), { onConflict: 'id' });
      if (error) { toast('Could not import: ' + errText(error), 'error'); return; }
      toast('Starter socks added', 'success');
      await loadAll();
    }

    /* ---------- tabs ---------- */
    function switchTab(tab) {
      state.tab = tab;
      $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
      $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    }

    function renderAll() {
      renderStats();
      renderOrders();
      renderInventory();
      renderProducts();
    }

    /* ---------- events ---------- */
    $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    ['orderSearch'].forEach((id) => $('#' + id).addEventListener('input', renderOrders));
    ['orderPayFilter', 'orderStatusFilter'].forEach((id) => $('#' + id).addEventListener('change', renderOrders));
    $('#invSearch').addEventListener('input', renderInventory);
    $('#exportCsv').addEventListener('click', exportCsv);

    $('#ordersBody').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-status-for]');
      if (sel) setOrderStatus(sel.dataset.statusFor, sel.value);
    });
    $('#ordersBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view-order]');
      if (btn) showOrder(btn.dataset.viewOrder);
    });

    $('#inventoryBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-step]');
      if (!btn) return;
      const p = findProduct(btn.dataset.id);
      if (p) adjustStock(p.id, parseInt(btn.dataset.step, 10));
    });
    $('#inventoryBody').addEventListener('change', (e) => {
      const input = e.target.closest('[data-stock-input]');
      if (input) setStock(input.dataset.stockInput, input.value);
    });

    $('#addProductBtn').addEventListener('click', () => openProductForm(null));
    $('#productsBody').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-delete]');
      if (edit) openProductForm(edit.dataset.edit);
      else if (del) deleteProduct(del.dataset.delete);
    });
    $('#productForm').addEventListener('submit', saveProductForm);
    $('#pImages').addEventListener('change', async (e) => {
      await addPhotos(e.target.files);
      e.target.value = '';
    });
    $('#pImagePreview').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rm-img]');
      if (!btn) return;
      formImages.splice(parseInt(btn.dataset.rmImg, 10), 1);
      renderImagePreview();
    });

    $('#refreshBtn').addEventListener('click', async () => { await loadAll(); toast('Refreshed', 'success'); });
    $('#importSeedBtn').addEventListener('click', importStarterProducts);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = $$('.modal-backdrop').find((m) => !m.hidden);
      if (modal) closeModal(modal.id);
    });

    // Reload when you come back to this tab, so you always see the newest orders and stock
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !$('#dashboard').hidden) loadAll();
    });

    bindModalDismiss();
    switchTab('orders');
    showAuthState();
  }

  /* ===================== BOOT ===================== */
  async function boot() {
    const page = document.body.dataset.page;
    if (page === 'store') {
      let loadError = null;
      try { await loadProducts(); } catch (err) { loadError = err; }
      initStore(loadError);
    } else if (page === 'admin') {
      initAdmin();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
