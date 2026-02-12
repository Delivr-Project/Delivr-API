import type { Config } from 'dompurify';

/**
 * Shared DOMPurify configuration for email HTML sanitization.
 * Used by both backend (parser) and should match frontend config.
 * 
 * Strategy: Backend does full sanitization on parse/store,
 * client does lightweight verify + client-specific transforms.
 */
export const EMAIL_PURIFY_CONFIG: Config = {
    USE_PROFILES: { html: true },

    // Forbid dangerous URI schemes
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,

    // Forbid forms, iframes, scripts etc.
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'meta', 'link', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onsubmit', 'onreset', 'onselect', 'onchange', 'onkeydown', 'onkeypress', 'onkeyup'],

    // Remove contents of dangerous elements (not just the tags)
    KEEP_CONTENT: true,
    // Allow ARIA attributes
    ALLOW_ARIA_ATTR: true,
};
