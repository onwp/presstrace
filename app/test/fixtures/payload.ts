import { randomBytes } from "node:crypto";

/**
 * Builds payloads shaped exactly like docs-site/reference/payload.md, modelled on a
 * WooCommerce product page with a slow payment plugin.
 */

export const txnId = () => randomBytes(16).toString("hex");

export interface ProductPageOptions {
  ts?: number;
  id?: string;
  name?: string;
  url?: string;
  externalMs?: number;
  metaLoops?: number;
  withWarning?: boolean;
  status?: number;
  type?: string;
}

export function productPageTransaction(o: ProductPageOptions = {}) {
  const externalMs = o.externalMs ?? 5002.21;
  const metaLoops = o.metaLoops ?? 12;
  const spans: Record<string, unknown>[] = [
    {
      kind: "plugin_load",
      name: "woocommerce/woocommerce.php",
      start: 12.4,
      duration: 18.9,
      component: "plugin:woocommerce",
    },
    {
      kind: "plugin_load",
      name: "payment-api-test/payment-api-test.php",
      start: 31.5,
      duration: 2.2,
      component: "plugin:payment-api-test",
    },
    { kind: "theme_load", name: "storefront", start: 60.2, duration: 4.1, component: "theme:storefront" },
    {
      kind: "db",
      name: "wp_options SELECT",
      start: 86.12,
      duration: 0.33,
      component: "core",
      sql: "SELECT option_name, option_value FROM wp_options WHERE autoload = 'yes'",
      rows: 412,
      error: null,
      stack: null,
    },
  ];
  let t = 100;
  for (let i = 0; i < metaLoops; i++) {
    spans.push({
      kind: "db",
      name: "wp_postmeta SELECT",
      start: t,
      duration: 1.6,
      component: "plugin:woocommerce",
      sql: `SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN (${100 + i}) ORDER BY meta_id ASC`,
      rows: 24,
      error: null,
      stack: [
        "wp-includes/meta.php:1189 update_meta_cache",
        "wp-content/plugins/woocommerce/includes/class-wc-product.php:88 get_post_meta",
      ],
    });
    t += 2;
  }
  for (let i = 0; i < 3; i++) {
    spans.push({
      kind: "db",
      name: "wp_options SELECT",
      start: t,
      duration: 0.21,
      component: "plugin:payment-api-test",
      sql: "SELECT option_value FROM wp_options WHERE option_name = 'payment_api_mode' LIMIT 1",
      rows: 0,
      error: null,
      stack: null,
    });
    t += 0.5;
  }
  spans.push({
    kind: "db",
    name: "wp_payment_log SELECT",
    start: t,
    duration: 140.5,
    component: "plugin:payment-api-test",
    sql: "SELECT * FROM wp_payment_log WHERE created_at > '2026-10-01 00:00:00' ORDER BY id DESC",
    rows: 1200,
    error: null,
    stack: ["wp-content/plugins/payment-api-test/payment.php:60 PaymentLog::recent"],
  });
  spans.push(
    {
      kind: "callback",
      name: "update_card_payment",
      start: 190.4,
      duration: externalMs + 1.8,
      self: 1.8,
      component: "plugin:payment-api-test",
      hook: "action:woocommerce_add_to_cart",
      file: "wp-content/plugins/payment-api-test/payment.php:42",
    },
    {
      kind: "http",
      name: "api.stripe.com POST",
      start: 191.0,
      duration: externalMs,
      component: "plugin:payment-api-test",
      url: "https://api.stripe.com/v1/charges",
      method: "POST",
      status: 200,
      error: null,
      stack: ["class-wc-cart.php:1276 do_action", "class-wp-hook.php:309 WC_Form_Handler::add_to_cart_action"],
    },
    {
      kind: "callback",
      name: "WC_Template_Loader::template_loader",
      start: 80.1,
      duration: 3.4,
      self: 3.4,
      component: "plugin:woocommerce",
      hook: "filter:template_include",
      file: "wp-content/plugins/woocommerce/includes/class-wc-template-loader.php:61",
    },
  );
  const dbSpans = spans.filter((s) => s.kind === "db");
  const dbTime = dbSpans.reduce((n, s) => n + (s.duration as number), 0);
  const duration = 260 + externalMs + dbTime;
  return {
    id: o.id ?? txnId(),
    ts: o.ts ?? Date.now(),
    name: o.name ?? "single-product",
    type: o.type ?? "frontend",
    method: "GET",
    url: o.url ?? "https://shop.example.com/product/album/",
    status: o.status ?? 200,
    duration: Math.round(duration * 1000) / 1000,
    db_time: Math.round(dbTime * 1000) / 1000,
    db_count: dbSpans.length,
    http_time: externalMs,
    http_count: 1,
    memory_peak_mb: 48.2,
    sample_rate: 1.0,
    user_logged_in: false,
    spans,
    components: [
      { component: "plugin:payment-api-test", time: externalMs + 4.0, calls: 1 },
      { component: "plugin:woocommerce", time: 120.5, calls: 940 },
      { component: "theme:storefront", time: 14.2, calls: 37 },
    ],
    errors: o.withWarning
      ? [
          {
            level: "warning",
            message: 'Undefined array key "foo"',
            file: "wp-content/plugins/demo/demo.php",
            line: 12,
            component: "plugin:demo",
          },
        ]
      : [],
    dropped_spans: 0,
  };
}

export function fastHomeTransaction(ts = Date.now()) {
  return {
    id: txnId(),
    ts,
    name: "home",
    type: "frontend",
    method: "GET",
    url: "https://shop.example.com/",
    status: 200,
    duration: 182.4,
    db_time: 12.5,
    db_count: 2,
    http_time: 0,
    http_count: 0,
    memory_peak_mb: 22.1,
    sample_rate: 1,
    user_logged_in: false,
    spans: [
      {
        kind: "db",
        name: "wp_options SELECT",
        start: 20,
        duration: 2.5,
        component: "core",
        sql: "SELECT option_name, option_value FROM wp_options WHERE autoload = 'yes'",
        rows: 400,
        error: null,
        stack: ["wp-includes/option.php:1123 wp_load_alloptions"],
      },
      {
        kind: "db",
        name: "wp_posts SELECT",
        start: 60,
        duration: 10,
        component: "core",
        sql: "SELECT SQL_CALC_FOUND_ROWS wp_posts.ID FROM wp_posts WHERE 1=1 AND wp_posts.post_type = 'post' ORDER BY wp_posts.post_date DESC LIMIT 0, 10",
        rows: 10,
        error: null,
        stack: ["wp-includes/class-wp-query.php:3300 WP_Query->get_posts"],
      },
    ],
    components: [{ component: "theme:storefront", time: 9.1, calls: 22 }],
    errors: [],
    dropped_spans: 0,
  };
}

export function payloadOf(transactions: object[]) {
  return {
    v: 1,
    agent: "0.1.0",
    env: { php: "8.3.12", wp: "6.8.3", memory_limit_mb: 256, object_cache: false, db_capture: "dropin" },
    transactions,
  };
}
