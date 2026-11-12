export default [
  {
    ignores: ["app/index.js", "dist/**", ".wrangler/**", "node_modules/**"],
  },
  {
    files: [
      "app/quote-engine.js",
      "app/trial.js",
      "app/access.js",
      "app/sms.js",
      "app/billing.js",
      "app/stripe_webhook.js",
      "app/platform-admin.js",
      "app/drivers.js",
      "app/progress-nav.js",
      "test/**/*.js",
      "scripts/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
    },
  },
];
