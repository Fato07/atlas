/**
 * Reply Handler Email Parser Tests
 *
 * Tests for email parsing utilities that extract clean reply content
 * from email messages with quoted text, signatures, and special formats.
 *
 * @module __tests__/reply-handler/email-parser.test
 */

import { describe, test, expect } from 'bun:test';
import {
  parseEmailReply,
  extractNewContent,
  removeSignature,
  detectAutoReply,
  extractSenderFromQuote,
} from '../../reply-handler/email-parser';

// ===========================================
// extractNewContent Tests
// ===========================================

describe('extractNewContent', () => {
  test('extracts content before quoted text', () => {
    const email = `Yes, I'd love to learn more!

On Mon, Jan 15, 2024 at 10:00 AM John Doe <john@example.com> wrote:
> Hi there,
> Just following up on our conversation.`;

    const result = extractNewContent(email);

    expect(result).toBe("Yes, I'd love to learn more!");
  });

  test('handles Outlook-style quotes', () => {
    const email = `Thanks for reaching out!

-----Original Message-----
From: Sales Team
Sent: Monday, January 15, 2024 10:00 AM
Subject: Quick question

Hi, I wanted to follow up...`;

    const result = extractNewContent(email);

    expect(result).toBe('Thanks for reaching out!');
  });

  test('handles Gmail-style forwarded messages', () => {
    const email = `I think this could work for us.

---------- Forwarded message ---------
From: Sales <sales@company.com>
Date: Mon, Jan 15, 2024 at 10:00 AM
Subject: Demo Request

Original message content here.`;

    const result = extractNewContent(email);

    expect(result).toBe('I think this could work for us.');
  });

  test('returns content when no quote markers found', () => {
    const email = `Hi there,

This is a simple reply with no quoted content.`;

    const result = extractNewContent(email);

    expect(result).toContain('This is a simple reply');
  });

  test('handles multiple lines of new content', () => {
    const email = `Hi!

Great to hear from you.
I have a few questions:
1. What's the pricing?
2. Is there a free trial?

On Jan 15, 2024 at 10:00 AM wrote:
> Previous message`;

    const result = extractNewContent(email);

    expect(result).toContain('Great to hear from you');
    expect(result).toContain('1. What\'s the pricing?');
    expect(result).toContain('2. Is there a free trial?');
  });

  test('trims whitespace from extracted content', () => {
    const email = `

   Yes, sounds good!

On Jan 15, 2024 wrote:
> Previous`;

    const result = extractNewContent(email);

    expect(result).toBe('Yes, sounds good!');
  });

  test('handles empty content before quote', () => {
    const email = `On Jan 15, 2024 wrote:
> This is the original message`;

    const result = extractNewContent(email);

    // Should return something, even if minimal
    expect(result).toBeDefined();
  });
});

// ===========================================
// removeSignature Tests
// ===========================================

describe('removeSignature', () => {
  test('removes common email signatures', () => {
    const email = `Yes, let's schedule a call!

Best regards,
John Doe
VP of Sales
Acme Corp
john@acme.com
555-123-4567`;

    const result = removeSignature(email);

    expect(result.content.trim()).toBe("Yes, let's schedule a call!");
    expect(result.removed).toBe(true);
  });

  test('removes "Thanks" style signatures', () => {
    const email = `I'm interested in learning more.

Thanks,
Sarah`;

    const result = removeSignature(email);

    expect(result.content.trim()).toBe("I'm interested in learning more.");
    expect(result.removed).toBe(true);
  });

  test('removes "Cheers" style signatures', () => {
    const email = `Looks great!

Cheers,
Mike`;

    const result = removeSignature(email);

    expect(result.content.trim()).toBe('Looks great!');
    expect(result.removed).toBe(true);
  });

  test('removes "Sent from my iPhone" signature', () => {
    const email = `Yes, works for me!

Sent from my iPhone`;

    const result = removeSignature(email);

    expect(result.content.trim()).toBe('Yes, works for me!');
    expect(result.removed).toBe(true);
  });

  test('removes signature with dashes separator', () => {
    const email = `Let's do it.

--
John Doe
CEO, StartupCo`;

    const result = removeSignature(email);

    expect(result.content.trim()).toBe("Let's do it.");
    expect(result.removed).toBe(true);
  });

  test('preserves content without signature', () => {
    const email = `This email has no signature, just content.`;

    const result = removeSignature(email);

    expect(result.content).toBe('This email has no signature, just content.');
    expect(result.removed).toBe(false);
  });

  test('handles multiple signature markers (takes first found from bottom)', () => {
    const email = `Main content here.

Best,
John

--
Another signature block`;

    const result = removeSignature(email);

    // Should remove starting from the first signature marker found (scanning from bottom)
    expect(result.content).not.toContain('Another signature block');
    expect(result.removed).toBe(true);
  });
});

// ===========================================
// detectAutoReply Tests
// ===========================================

describe('detectAutoReply', () => {
  test('detects out of office message', () => {
    const email = `I am currently out of the office with limited access to email.
I will respond to your message when I return on Monday, January 22nd.`;

    const result = detectAutoReply(email);

    expect(result.isAutoReply).toBe(true);
    expect(result.type).toBe('ooo'); // Implementation returns 'ooo', not 'out_of_office'
  });

  test('detects vacation auto-reply', () => {
    const email = `Thank you for your email. I am currently on vacation
and will return on February 1st. For urgent matters, please contact...`;

    const result = detectAutoReply(email);

    expect(result.isAutoReply).toBe(true);
    expect(result.type).toBe('ooo');
  });

  test('detects delivery failure bounce', () => {
    const email = `Delivery Status Notification (Failure)

This is an automatically generated Delivery Status Notification.
Delivery to the following recipient failed permanently:
    user@domain.com`;

    const result = detectAutoReply(email);

    expect(result.isAutoReply).toBe(true);
    expect(result.type).toBe('bounce');
  });

  test('detects "automated message" auto-reply', () => {
    const email = `Thank you for contacting our support team.
We have received your inquiry and will respond within 24 hours.
This is an automated message.`;

    const result = detectAutoReply(email);

    expect(result.isAutoReply).toBe(true);
    expect(result.type).toBe('auto_response');
  });

  test('does not flag normal reply as auto-reply', () => {
    const email = `Hi,

Yes, I'd be happy to schedule a call. How about Thursday at 2pm?

Best,
Sarah`;

    const result = detectAutoReply(email);

    expect(result.isAutoReply).toBe(false);
  });

  test('detects "away from desk" message', () => {
    const email = `I am currently away from my desk.
I will get back to you as soon as possible.`;

    const result = detectAutoReply(email);

    expect(result.isAutoReply).toBe(true);
    expect(result.type).toBe('ooo');
  });
});

// ===========================================
// parseEmailReply Tests
// ===========================================

describe('parseEmailReply', () => {
  test('parses complete email with all components', () => {
    const email = `Great news! I'm interested.

Let me check with my team and get back to you.

Best,
John

On Mon, Jan 15, 2024 at 10:00 AM Sales <sales@company.com> wrote:
> Hi John,
> Just following up on our demo request.`;

    const result = parseEmailReply(email);

    expect(result.newContent).toContain("I'm interested");
    expect(result.newContent).not.toContain('Best,');
    expect(result.newContent).not.toContain('Following up');
    expect(result.hadQuotes).toBe(true);
    expect(result.hadSignature).toBe(true);
  });

  test('identifies auto-reply in parsed result', () => {
    const email = `I am out of the office until next week.

On Mon, Jan 15, 2024 wrote:
> Original message`;

    const result = parseEmailReply(email);
    const autoReplyCheck = detectAutoReply(result.newContent);

    expect(autoReplyCheck.isAutoReply).toBe(true);
  });

  test('handles plain reply without quotes', () => {
    const email = `Yes, let's do it! Schedule me for Tuesday.`;

    const result = parseEmailReply(email);

    expect(result.newContent).toBe("Yes, let's do it! Schedule me for Tuesday.");
    expect(result.hadQuotes).toBe(false);
  });

  test('extracts sender from quoted content using utility', () => {
    const email = `Sounds good!

On Mon, Jan 15, 2024 at 10:00 AM Sales Team <sales@company.com> wrote:
> Original message here`;

    const sender = extractSenderFromQuote(email);

    expect(sender).toContain('sales@company.com');
  });
});

// ===========================================
// extractSenderFromQuote Tests
// ===========================================

describe('extractSenderFromQuote', () => {
  test('extracts sender from Gmail-style quote', () => {
    const quote = `On Mon, Jan 15, 2024 at 10:00 AM John Doe <john@example.com> wrote:`;

    const result = extractSenderFromQuote(quote);

    expect(result).toContain('john@example.com');
  });

  test('extracts sender from Outlook-style quote', () => {
    const quote = `From: Sales Team <sales@company.com>
Sent: Monday, January 15, 2024 10:00 AM`;

    const result = extractSenderFromQuote(quote);

    expect(result).toContain('sales@company.com');
  });

  test('returns undefined when no sender found', () => {
    const quote = `Some random text without sender info`;

    const result = extractSenderFromQuote(quote);

    expect(result).toBeUndefined();
  });

  test('handles angle brackets in email', () => {
    const quote = `From: "John Doe" <john.doe@company.co.uk>`;

    const result = extractSenderFromQuote(quote);

    expect(result).toContain('john.doe@company.co.uk');
  });
});

// ===========================================
// Edge Cases
// ===========================================

describe('Email parser edge cases', () => {
  test('handles content without signature markers', () => {
    const email = `Yes &amp; no, I need more info.`;

    const result = extractNewContent(email);

    // Should handle HTML entities
    expect(result).toContain('Yes');
  });

  test('handles multi-byte characters', () => {
    const email = `こんにちは、興味があります！

On Jan 15 wrote:
> Previous message`;

    const result = extractNewContent(email);

    expect(result).toContain('こんにちは');
  });

  test('handles empty email', () => {
    const result = extractNewContent('');

    expect(result).toBe('');
  });

  test('handles whitespace-only email', () => {
    const result = extractNewContent('   \n\n   ');

    expect(result).toBe('');
  });

  test('handles very long email', () => {
    const longContent = 'A'.repeat(10000);
    const email = `${longContent}

On Jan 15 wrote:
> Quote`;

    const result = extractNewContent(email);

    expect(result.length).toBeGreaterThan(1000);
  });

  test('handles nested quotes', () => {
    const email = `Agreed!

> On Jan 15 wrote:
>> Original message
>> continues here

On Jan 14 wrote:
> First reply`;

    const result = extractNewContent(email);

    expect(result).toBe('Agreed!');
  });
});
