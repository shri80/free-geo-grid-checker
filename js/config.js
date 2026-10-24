// Single place to edit branding and lead-capture settings.

// Apps Script web app URL (see docs/lead-webhook.gs). While empty, leads are kept locally and retried once it is set.
export const LEAD_WEBHOOK_URL = '';

// Show the email prompt after this many completed scans, then again every N scans if skipped.
export const PROMPT_EVERY = 3;

export const BRAND = {
  name: 'GMB Briefcase',
  url: 'https://gmbbriefcase.com',
  privacyUrl: 'https://gmbbriefcase.com/privacy-policy',
  promptTitle: 'Get more out of local rankings',
  promptText: 'Leave your email and we will send local SEO tips and updates to this tool. Everything stays free either way.',
  ctaText: 'Want this tracked automatically every week and sent to clients as a branded report?',
  ctaButton: 'Try GMB Briefcase',
};
