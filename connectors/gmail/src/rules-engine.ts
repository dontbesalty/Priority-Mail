/**
 * rules-engine.ts
 *
 * Fast, deterministic pre-classification before calling the AI.
 * Rules run in order — first match wins.
 * Cost: $0. Latency: <1ms per email.
 */

import { NormalizedEmail } from "./normalize";

export type Priority = "High" | "Medium" | "Low";
export type Category =
  | "Client Request"
  | "Internal Team"
  | "Billing / Invoice"
  | "Sales Lead"
  | "Support Issue"
  | "Waiting On Someone Else"
  | "Newsletter / Marketing"
  | "Spam / Low Importance"
  | "Security Alert"
  | "Real Estate"
  | "Financial Update"
  | "Other";

export interface RulesResult {
  priority?: Priority;
  category?: Category;
  confidence: number;    // 1.0 = hard rule, 0 = no rule fired
  rule_fired?: string;
  skip_ai: boolean;      // true = don't call any AI for this email
  local_ai_only: boolean; // true = only use LOCAL_AI_URL, never send to cloud
}

// ── Known newsletter / bulk-mail sending domains ──────────────────────────────
const NEWSLETTER_SENDER_DOMAINS = new Set([
  "substack.com",
  "morningbrew.com",
  "newsletter.com",
  "beehiiv.com",
  "mailchimp.com",
  "constantcontact.com",
  "sendgrid.net",
  "klaviyo.com",
  "convertkit.com",
  "campaignmonitor.com",
  "sendinblue.com",
]);

// ── Known promotional / retail e-mail domains ─────────────────────────────────
const PROMO_SENDER_DOMAINS = new Set([
  "e.lowes.com",
  "subs.subway.com",
  "em.walmart.com",
  "eml.walgreens.com",
  "ebay.com",
  "deals.aliexpress.com",
  "woot.com",
  "classicfirearms.com",
  "estesrockets.com",
]);

// ── Real-estate alert domains ─────────────────────────────────────────────────
const REAL_ESTATE_DOMAINS = new Set([
  "mail.zillow.com",
  "redfin.com",
  "realtor.com",
]);

// ── Security / 2FA sender domains — NEVER sent to external AI ─────────────────
// These may contain OTP codes, recovery links, or account-access details.
const SECURITY_SENDER_DOMAINS = new Set([
  "accounts.google.com",
  "account.microsoft.com",
  "facebookmail.com",
  "twitteremail.com",
  "x.com",
  "amazonses.com",     // covers AWS SES security emails
  "github.com",
  "gitlab.com",
  "apple.com",
  "icloud.com",
  // Note: linkedin.com intentionally excluded so job-alert emails can reach AI.
  // LinkedIn 2FA subjects are caught by SECURITY_SUBJECT_RE below.
  "paypal.com",
  "stripe.com",
  "twilio.com",
  "okta.com",
  "auth0.com",
  "onelogin.com",
  "duo.com",
  "authy.com",
]);

// Subject keywords that strongly indicate 2FA / verification emails
const SECURITY_SUBJECT_RE =
  /\b(verification|verify|verif[yi]|one[- ]?time (password|code|pin)|otp\b|two[- ]?factor|2fa\b|auth(entic)? ?code|security code|sign[- ]?in code|login code|access code|confirm your|account (recovery|confirmation|verified)|new (sign[- ]?in|login|device)|unusual (sign[- ]?in|activity)|suspicious (sign[- ]?in|activity)|reset your (password|account)|password reset|your .{0,20}(code|pin) is)\b/i;

// Body / subject patterns that indicate confidential / privileged content.
// These emails may still benefit from AI triage, but should only use a local
// model — never sent to a cloud provider.
const CONFIDENTIAL_RE =
  /\b(confidential|privileged\s+and\s+confidential|attorney[- ]client\s+privilege|strictly\s+confidential|proprietary\s+and\s+confidential|not\s+for\s+distribution|intended\s+only\s+for\s+the\s+(named|intended)\s+recipient|this\s+(e[- ]?mail|message|communication)\s+(is\s+)?(confidential|private|privileged))\b/i;

function senderDomain(from: string): string {
  const match = from.match(/@([\w.-]+)/);
  return match ? match[1].toLowerCase() : "";
}

// ── Rule runner ───────────────────────────────────────────────────────────────

export function applyRules(email: NormalizedEmail): RulesResult {
  const labels = email.labels.map((l) => l.toUpperCase());
  const subject = email.subject.toLowerCase();
  const body = email.body.toLowerCase().slice(0, 800);
  const from = email.from.toLowerCase();
  const domain = senderDomain(email.from);

  // ── Gmail promotional / social labels → skip AI entirely ──────────────────
  if (labels.includes("CATEGORY_PROMOTIONS")) {
    return {
      priority: "Low", category: "Newsletter / Marketing",
      confidence: 1.0, rule_fired: "gmail_promotions_label",
      skip_ai: true, local_ai_only: false,
    };
  }
  if (labels.includes("CATEGORY_SOCIAL")) {
    return {
      priority: "Low", category: "Newsletter / Marketing",
      confidence: 1.0, rule_fired: "gmail_social_label",
      skip_ai: true, local_ai_only: false,
    };
  }

  // ── Known newsletter sender domains ───────────────────────────────────────
  for (const d of NEWSLETTER_SENDER_DOMAINS) {
    if (domain.endsWith(d)) {
      return {
        priority: "Low", category: "Newsletter / Marketing",
        confidence: 1.0, rule_fired: `newsletter_domain:${d}`,
        skip_ai: true, local_ai_only: false,
      };
    }
  }

  // ── Known promotional retail domains ──────────────────────────────────────
  for (const d of PROMO_SENDER_DOMAINS) {
    if (domain.endsWith(d)) {
      return {
        priority: "Low", category: "Newsletter / Marketing",
        confidence: 1.0, rule_fired: `promo_domain:${d}`,
        skip_ai: true, local_ai_only: false,
      };
    }
  }

  // ── Real estate alerts ─────────────────────────────────────────────────────
  for (const d of REAL_ESTATE_DOMAINS) {
    if (domain.endsWith(d)) {
      return {
        priority: "Low", category: "Real Estate",
        confidence: 1.0, rule_fired: `real_estate_domain:${d}`,
        skip_ai: true, local_ai_only: false,
      };
    }
  }

  // ── Security / 2FA — NEVER sent to ANY AI (local or cloud) ────────────────
  for (const d of SECURITY_SENDER_DOMAINS) {
    if (domain.endsWith(d)) {
      return {
        priority: "Medium", category: "Security Alert",
        confidence: 1.0, rule_fired: `security_sender_domain:${d}`,
        skip_ai: true, local_ai_only: false,
      };
    }
  }
  if (SECURITY_SUBJECT_RE.test(email.subject)) {
    return {
      priority: "Medium", category: "Security Alert",
      confidence: 0.95, rule_fired: "security_subject_keywords",
      skip_ai: true, local_ai_only: false,
    };
  }

  // ── Confidential / privileged content — local AI only ─────────────────────
  // If the email body or subject contains a confidentiality notice, only use a
  // local model (LOCAL_AI_URL). If no local AI is configured, skip AI entirely.
  const fullText = email.subject + " " + email.body.slice(0, 1200);
  if (CONFIDENTIAL_RE.test(fullText)) {
    return {
      priority: "High", category: "Client Request",
      confidence: 0.9, rule_fired: "confidential_notice",
      skip_ai: false, local_ai_only: true,
    };
  }

  // ── Billing / deadline subjects ────────────────────────────────────────────
  if (/invoice|payment due|past due|amount due|overdue/i.test(subject)) {
    return {
      priority: "High", category: "Billing / Invoice",
      confidence: 0.9, rule_fired: "subject_billing_keywords",
      skip_ai: false, local_ai_only: false,
    };
  }
  if (/\d+\s*days?\s*(left|remaining|until|to (file|pay|respond|reply))/i.test(subject)) {
    return {
      priority: "High", category: "Other",
      confidence: 0.85, rule_fired: "subject_deadline_days",
      skip_ai: false, local_ai_only: false,
    };
  }

  // ── Annual report / compliance body text ──────────────────────────────────
  if (/annual report due|compliance deadline|late fee/i.test(body)) {
    return {
      priority: "High", category: "Billing / Invoice",
      confidence: 0.9, rule_fired: "body_compliance_keywords",
      skip_ai: false, local_ai_only: false,
    };
  }

  // ── Gmail updates category → medium, still worth AI classifying ───────────
  if (labels.includes("CATEGORY_UPDATES")) {
    return {
      priority: "Medium", category: "Other",
      confidence: 0.7, rule_fired: "gmail_updates_label",
      skip_ai: false, local_ai_only: false,
    };
  }

  // ── No rule matched — send to AI ──────────────────────────────────────────
  return { confidence: 0, skip_ai: false, local_ai_only: false };
}
