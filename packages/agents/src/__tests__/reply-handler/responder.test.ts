/**
 * Reply Handler Responder Tests
 *
 * Tests for response generation, template filling, and personalization.
 * Uses mocked Anthropic client to test response generation logic.
 *
 * @module __tests__/reply-handler/responder.test
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  ResponseGenerator,
  createResponder,
  previewTemplate,
  validateTemplate,
} from '../../reply-handler/responder';
import type { KBMatch } from '../../reply-handler/contracts/handler-result';
import type { LeadContext } from '../../reply-handler/contracts/reply-input';

// ===========================================
// Mock Anthropic Client
// ===========================================

function createMockAnthropicClient(personalizedResponse?: string) {
  return {
    messages: {
      create: mock(async () => ({
        content: [
          {
            type: 'text',
            text:
              personalizedResponse ??
              'Hi John, Thanks for your interest in our solution!',
          },
        ],
        usage: {
          input_tokens: 150,
          output_tokens: 75,
        },
      })),
    },
  };
}

// ===========================================
// Test Fixtures
// ===========================================

function createKBMatch(overrides: Partial<KBMatch> = {}): KBMatch {
  return {
    type: 'template',
    id: 'template_positive_001',
    confidence: 0.92,
    content:
      'Hi {{first_name}},\n\nThanks for your interest! I\'d love to schedule a call.\n\nBook time here: {{meeting_link}}\n\nBest,\n{{sender_name}}',
    personalization_instructions:
      'Reference their industry and company if known.',
    ...overrides,
  };
}

function createLeadContext(overrides: Partial<LeadContext> = {}): LeadContext {
  return {
    email: 'john.smith@acme.com',
    first_name: 'John',
    last_name: 'Smith',
    company: 'Acme Corp',
    title: 'VP Engineering',
    industry: 'Technology',
    ...overrides,
  };
}

// ===========================================
// Responder Creation Tests
// ===========================================

describe('ResponseGenerator creation', () => {
  test('creates responder with required config', () => {
    const mockClient = createMockAnthropicClient();
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
    });

    expect(responder).toBeDefined();
    expect(responder).toBeInstanceOf(ResponseGenerator);
  });

  test('creates responder with custom personalization settings', () => {
    const mockClient = createMockAnthropicClient();
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        model: 'claude-3-haiku-20240307',
        maxTokens: 256,
        enabled: false,
      },
    });

    expect(responder).toBeDefined();
  });
});

// ===========================================
// Template Filling Tests (FR-012)
// ===========================================

describe('Template filling', () => {
  let responder: ResponseGenerator;

  beforeEach(() => {
    const mockClient = createMockAnthropicClient();
    responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: false,
      },
    });
  });

  test('fills basic template variables', () => {
    const template = 'Hi {{first_name}}, welcome to {{company}}!';
    const variables = {
      first_name: 'John',
      company: 'Acme Corp',
    };

    const result = responder.fillTemplate(template, variables as any);

    expect(result).toBe('Hi John, welcome to Acme Corp!');
  });

  test('fills all lead context variables', () => {
    const template = '{{first_name}} {{last_name}} at {{company}} ({{title}})';
    const variables = {
      first_name: 'John',
      last_name: 'Smith',
      company: 'Acme Corp',
      title: 'VP Engineering',
    };

    const result = responder.fillTemplate(template, variables as any);

    expect(result).toBe('John Smith at Acme Corp (VP Engineering)');
  });

  test('fills campaign variables', () => {
    const template = 'Book time: {{meeting_link}}\n\nBest,\n{{sender_name}}';
    const variables = {
      meeting_link: 'https://calendly.com/sarah',
      sender_name: 'Sarah',
    };

    const result = responder.fillTemplate(template, variables as any);

    expect(result).toBe('Book time: https://calendly.com/sarah\n\nBest,\nSarah');
  });

  test('preserves unresolved variables', () => {
    const template = 'Hi {{first_name}}, your code is {{promo_code}}';
    const variables = {
      first_name: 'John',
    };

    const result = responder.fillTemplate(template, variables as any);

    expect(result).toBe('Hi John, your code is {{promo_code}}');
  });

  test('handles empty variable values', () => {
    const template = 'Hi {{first_name}}, at {{company}}';
    const variables = {
      first_name: 'John',
      company: '', // Empty string
    };

    const result = responder.fillTemplate(template, variables as any);

    expect(result).toContain('{{company}}'); // Should preserve placeholder
  });

  test('is case-insensitive for variable names', () => {
    const template = 'Hi {{FIRST_NAME}}, at {{Company}}';
    const variables = {
      first_name: 'John',
      company: 'Acme',
    };

    const result = responder.fillTemplate(template, variables as any);

    expect(result).toBe('Hi John, at Acme');
  });
});

// ===========================================
// Template Variable Extraction Tests
// ===========================================

describe('Template variable extraction', () => {
  let responder: ResponseGenerator;

  beforeEach(() => {
    const mockClient = createMockAnthropicClient();
    responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
    });
  });

  test('extracts all variables from template', () => {
    const template = 'Hi {{first_name}}, at {{company}}. Link: {{meeting_link}}';
    const variables = responder.getTemplateVariables(template);

    expect(variables).toContain('first_name');
    expect(variables).toContain('company');
    expect(variables).toContain('meeting_link');
    expect(variables).toHaveLength(3);
  });

  test('deduplicates repeated variables', () => {
    const template = 'Hi {{first_name}}! {{first_name}}, how are you?';
    const variables = responder.getTemplateVariables(template);

    expect(variables.filter(v => v === 'first_name')).toHaveLength(1);
  });

  test('returns empty array for template without variables', () => {
    const template = 'Hello there! How can I help?';
    const variables = responder.getTemplateVariables(template);

    expect(variables).toHaveLength(0);
  });
});

// ===========================================
// Response Generation Tests
// ===========================================

describe('Response generation', () => {
  let mockClient: ReturnType<typeof createMockAnthropicClient>;

  test('generates response without personalization', async () => {
    mockClient = createMockAnthropicClient();
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: false,
      },
    });

    const result = await responder.generateResponse({
      kbMatch: createKBMatch({ personalization_instructions: undefined }),
      leadContext: createLeadContext(),
      replyText: 'Yes, interested!',
    });

    expect(result.responseText).toContain('John');
    expect(result.responseText).toContain('Sarah');
    expect(result.personalized).toBe(false);
    expect(result.tokensUsed).toBe(0);
  });

  test('generates response with personalization', async () => {
    mockClient = createMockAnthropicClient(
      'Hi John, As a VP Engineering at Acme Corp, you\'ll appreciate our tech focus. Book time: https://calendly.com/sarah\n\nBest,\nSarah'
    );
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: true,
      },
    });

    const result = await responder.generateResponse({
      kbMatch: createKBMatch(),
      leadContext: createLeadContext(),
      replyText: 'Yes, interested!',
    });

    expect(result.personalized).toBe(true);
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(mockClient.messages.create).toHaveBeenCalled();
  });

  test('skips personalization when no instructions', async () => {
    mockClient = createMockAnthropicClient();
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: true,
      },
    });

    const kbMatch = createKBMatch({ personalization_instructions: undefined });

    const result = await responder.generateResponse({
      kbMatch,
      leadContext: createLeadContext(),
      replyText: 'Yes, interested!',
    });

    expect(result.personalized).toBe(false);
    expect(mockClient.messages.create).not.toHaveBeenCalled();
  });

  test('handles personalization error gracefully', async () => {
    mockClient = {
      messages: {
        create: mock(async () => {
          throw new Error('API error');
        }),
      },
    };
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: true,
      },
    });

    const result = await responder.generateResponse({
      kbMatch: createKBMatch(),
      leadContext: createLeadContext(),
      replyText: 'Yes, interested!',
    });

    // Should fallback to non-personalized response
    expect(result.responseText).toBeDefined();
    expect(result.tokensUsed).toBe(0);
  });

  test('includes thread context in personalization', async () => {
    mockClient = createMockAnthropicClient();
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: true,
      },
    });

    await responder.generateResponse({
      kbMatch: createKBMatch(),
      leadContext: createLeadContext(),
      replyText: 'Yes, interested!',
      threadContext: 'Previous email discussed pricing options.',
    });

    const createCall = (mockClient.messages.create as any).mock.calls[0][0];
    const userMessage = createCall.messages[0].content;
    expect(userMessage).toContain('Previous email discussed pricing options');
  });
});

// ===========================================
// Response Validation Tests
// ===========================================

describe('Response validation', () => {
  let responder: ResponseGenerator;

  beforeEach(() => {
    const mockClient = createMockAnthropicClient();
    responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
    });
  });

  test('validates clean response', () => {
    const response = 'Hi John, Thanks for your interest! Best, Sarah';
    const result = responder.validateResponse(response);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('detects unresolved variables', () => {
    const response = 'Hi {{first_name}}, Thanks for your interest!';
    const result = responder.validateResponse(response);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Unresolved variables: first_name');
  });

  test('detects too short response', () => {
    const response = 'Hi';
    const result = responder.validateResponse(response);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Response too short');
  });

  test('detects unprocessed personalization marker', () => {
    const response = 'Hi John, [PERSONALIZE: add industry mention] Best, Sarah';
    const result = responder.validateResponse(response);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Contains unprocessed personalization marker');
  });

  test('detects undefined/null values', () => {
    const response = 'Hi undefined, Thanks for contacting null';
    const result = responder.validateResponse(response);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Contains undefined/null values');
  });
});

// ===========================================
// Template Preview Utility Tests
// ===========================================

describe('previewTemplate utility', () => {
  test('previews template with default sample values', () => {
    const template = 'Hi {{first_name}}, at {{company}}';
    const preview = previewTemplate(template);

    expect(preview).toBe('Hi John, at Acme Corp');
  });

  test('previews template with custom sample values', () => {
    const template = 'Hi {{first_name}}, at {{company}}';
    const preview = previewTemplate(template, {
      first_name: 'Jane',
      company: 'TechCo',
    });

    expect(preview).toBe('Hi Jane, at TechCo');
  });

  test('marks unknown variables with brackets', () => {
    const template = 'Hi {{first_name}}, code: {{promo_code}}';
    const preview = previewTemplate(template);

    expect(preview).toContain('[promo_code]');
  });
});

// ===========================================
// Template Validation Utility Tests
// ===========================================

describe('validateTemplate utility', () => {
  test('validates correct template', () => {
    const template = 'Hi {{first_name}}, at {{company}}';
    const result = validateTemplate(template);

    expect(result.valid).toBe(true);
    expect(result.variables).toContain('first_name');
    expect(result.variables).toContain('company');
    expect(result.issues).toHaveLength(0);
  });

  test('detects empty template', () => {
    const result = validateTemplate('');

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Template is empty');
  });

  test('detects spaces in variable names', () => {
    const template = 'Hi {{first name}}, at {{ first_name }}';
    const result = validateTemplate(template);

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes('spaces'))).toBe(true);
  });

  test('extracts unique variables', () => {
    const template = '{{first_name}} {{first_name}} {{company}}';
    const result = validateTemplate(template);

    expect(result.variables).toContain('first_name');
    expect(result.variables).toContain('company');
    expect(result.variables).toHaveLength(2);
  });
});

// ===========================================
// Response Cleanup Tests
// ===========================================

describe('Response cleanup', () => {
  test('removes extra whitespace', async () => {
    const mockClient = createMockAnthropicClient(
      'Hi John,\n\n\n\nThanks for reaching out!\n\n\n\nBest,\nSarah'
    );
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: true,
      },
    });

    const result = await responder.generateResponse({
      kbMatch: createKBMatch(),
      leadContext: createLeadContext(),
      replyText: 'Yes, interested!',
    });

    // Should have max 2 consecutive newlines
    expect(result.responseText).not.toContain('\n\n\n');
  });

  test('removes common preambles from Claude response', async () => {
    const mockClient = createMockAnthropicClient(
      "Here's the personalized email:\n\nHi John, Thanks for your interest!"
    );
    const responder = createResponder({
      client: mockClient as any,
      campaign: {
        senderName: 'Sarah',
        meetingLink: 'https://calendly.com/sarah',
      },
      personalization: {
        enabled: true,
      },
    });

    const result = await responder.generateResponse({
      kbMatch: createKBMatch(),
      leadContext: createLeadContext(),
      replyText: 'Yes, interested!',
    });

    expect(result.responseText).not.toContain("Here's the personalized");
    expect(result.responseText).toContain('Hi John');
  });
});
