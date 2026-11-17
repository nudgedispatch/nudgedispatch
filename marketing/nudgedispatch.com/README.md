# Marketing site change (not published)

This folder is the proposed update to the nudgedispatch.com homepage CTAs.
Do not deploy Worker `nudge-sandbox` or change live DNS until Jesse explicitly approves a marketing-site publish.

## Change

In the beta / contact box (`#beta` `.cta-row`), keep the existing mailto and onboarding PDF, and add a primary self-serve button:

- **Create your account** → `https://app.nudgedispatch.com/signup`
- Keep **Ask about a 15-ride trial** (mailto) and **Download the onboarding form (PDF)** as concierge options.
- Note line: you can sign up yourself, or fill in the form and email it to nudgedispatch@gmail.com.

On each pricing card (or under the Solo card, since Solo is the only public plan), the public CTA should also point at `/signup`. Texting is not included on Solo. Use the upgrade note from `app/signup.js` (`TEXTING_UPGRADE_NOTE`):

> Need automatic texting? Available on Small fleet and up. Automatic ride and driver texts are sent from your company's Nudge number: $75 setup + $19/mo, with 500 texts included, then $0.03 each. On any plan, including Solo, you can still email or text invoices from your own phone.

See `cta-snippet.html` for the replacement markup of the beta box CTA row.
