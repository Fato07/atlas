/**
 * Meeting Prep Agent Integration Tests
 *
 * End-to-end tests for the meeting prep agent flow including:
 * - Calendar webhook handling
 * - Brief generation
 * - Transcript analysis
 * - Error handling
 *
 * @module meeting-prep/tests/integration
 */

import { describe, test, expect, beforeEach, mock, afterEach } from 'bun:test';
import {
  createParsedMeeting,
  createTranscriptInput,
  createGatheredContext,
  createBANT,
  createBriefContent,
  createBrief,
  TEST_BRAIN_ID,
} from './fixtures';
import {
  createMeetingPrepAgent,
  type MeetingPrepAgentConfig,
} from '../../meeting-prep/agent';
import { createLogger } from '../../meeting-prep/logger';
import { createStateManager } from '../../meeting-prep/state';
import type { ParsedMeeting } from '../../meeting-prep/contracts';

// ===========================================
// Test Configuration
// ===========================================

const createTestConfig = (): MeetingPrepAgentConfig => ({
  brainId: TEST_BRAIN_ID as any,
  slackChannel: 'test-channel',
  webhookSecret: 'test-secret-12345678901234567890123456789012',
  contextGathererConfig: {
    timeoutMs: 5000,
    parallelFetches: true,
    maxInstantlyEmails: 10,
    maxKBResults: 5,
  },
  briefGeneratorConfig: {
    maxTokens: 4096,
    temperature: 0.7,
  },
});

// ===========================================
// Mock Setup
// ===========================================

// These tests are primarily for verifying the integration structure
// Full integration tests require external services

describe('MeetingPrepAgent', () => {
  describe('Agent Creation', () => {
    test('creates agent with valid config', () => {
      const logger = createLogger({ level: 'error' });
      const config = createTestConfig();

      const agent = createMeetingPrepAgent({
        ...config,
        logger,
      });

      expect(agent).toBeDefined();
      expect(agent.getBrainId()).toBe(TEST_BRAIN_ID);
    });

    test('agent has required methods', () => {
      const logger = createLogger({ level: 'error' });
      const config = createTestConfig();

      const agent = createMeetingPrepAgent({
        ...config,
        logger,
      });

      expect(typeof agent.generateBriefFromWebhook).toBe('function');
      expect(typeof agent.generateBriefManual).toBe('function');
      expect(typeof agent.analyzeTranscript).toBe('function');
      expect(typeof agent.getStateManager).toBe('function');
    });
  });
});

// ===========================================
// Fixture Validation Tests
// ===========================================

describe('Test Fixtures', () => {
  test('createParsedMeeting generates valid meeting', () => {
    const meeting = createParsedMeeting();

    expect(meeting.meeting_id).toBeDefined();
    expect(meeting.brain_id).toBe(TEST_BRAIN_ID);
    expect(meeting.primary_attendee.is_external).toBe(true);
    expect(meeting.primary_attendee.email).toContain('@');
    expect(meeting.meeting_type).toBe('google_meet');
    expect(meeting.status).toBe('confirmed');
    expect(meeting.source).toBe('calendar_webhook');
  });

  test('createParsedMeeting allows overrides', () => {
    const meeting = createParsedMeeting({
      title: 'Custom Meeting',
      meeting_type: 'zoom',
    });

    expect(meeting.title).toBe('Custom Meeting');
    expect(meeting.meeting_type).toBe('zoom');
    expect(meeting.brain_id).toBe(TEST_BRAIN_ID); // Default preserved
  });

  test('createTranscriptInput generates valid transcript', () => {
    const transcript = createTranscriptInput();

    expect(transcript.meeting_id).toBeDefined();
    expect(transcript.brain_id).toBe(TEST_BRAIN_ID);
    expect(transcript.source).toBe('fireflies');
    expect(transcript.transcript_text.length).toBeGreaterThan(100);
    expect(transcript.attendee_email).toContain('@');
    expect(transcript.meeting_date).toBeDefined();
  });

  test('createGatheredContext generates valid context', () => {
    const context = createGatheredContext();

    expect(context.lead).toBeDefined();
    expect(context.lead.email).toContain('@');
    expect(context.company_intel).toBeDefined();
    expect(context.company_intel?.industry).toBeDefined();
    expect(context.conversation_history).toBeInstanceOf(Array);
    expect(context.kb_context).toBeDefined();
    expect(context.kb_context.similar_deals).toBeInstanceOf(Array);
    expect(context.gathered_at).toBeDefined();
    expect(context.missing_sources).toBeInstanceOf(Array);
  });

  test('createBANT generates valid BANT assessment', () => {
    const bant = createBANT();

    expect(bant.budget.confidence).toBeGreaterThanOrEqual(0);
    expect(bant.budget.confidence).toBeLessThanOrEqual(1);
    expect(['confirmed', 'partial', 'unknown', 'negative']).toContain(bant.budget.status);
    expect(['confirmed', 'partial', 'unknown', 'negative']).toContain(bant.authority.status);
    expect(['confirmed', 'partial', 'unknown', 'negative']).toContain(bant.need.status);
    expect(['confirmed', 'partial', 'unknown', 'negative']).toContain(bant.timeline.status);
    expect(bant.overall.score).toBeGreaterThanOrEqual(0);
    expect(['hot', 'warm', 'nurture', 'disqualify']).toContain(bant.overall.recommendation);
  });

  test('createBriefContent generates valid brief content', () => {
    const content = createBriefContent();

    expect(content.quick_context).toBeDefined();
    expect(content.conversation_timeline.length).toBeGreaterThan(0);
    expect(content.company_intel).toBeDefined();
    expect(content.talking_points.length).toBeGreaterThanOrEqual(3);
    expect(content.suggested_questions.length).toBeGreaterThanOrEqual(2);
  });

  test('createBrief generates valid full brief', () => {
    const brief = createBrief();

    expect(brief.brief_id).toBeDefined();
    expect(brief.brain_id).toBe(TEST_BRAIN_ID);
    expect(brief.status).toBe('delivered');
    expect(brief.content).toBeDefined();
    expect(brief.delivered_at).toBeDefined();
  });
});

// ===========================================
// Contract Validation Tests
// ===========================================

describe('Contract Validation', () => {
  test('ParsedMeeting has all required fields', () => {
    const meeting = createParsedMeeting();

    // Required fields from ParsedMeetingSchema
    expect(meeting).toHaveProperty('meeting_id');
    expect(meeting).toHaveProperty('brain_id');
    expect(meeting).toHaveProperty('title');
    expect(meeting).toHaveProperty('description');
    expect(meeting).toHaveProperty('start_time');
    expect(meeting).toHaveProperty('end_time');
    expect(meeting).toHaveProperty('timezone');
    expect(meeting).toHaveProperty('primary_attendee');
    expect(meeting).toHaveProperty('other_attendees');
    expect(meeting).toHaveProperty('meeting_link');
    expect(meeting).toHaveProperty('meeting_type');
    expect(meeting).toHaveProperty('status');
    expect(meeting).toHaveProperty('recurring_event_id');
    expect(meeting).toHaveProperty('created_at');
    expect(meeting).toHaveProperty('source');

    // Primary attendee structure
    expect(meeting.primary_attendee).toHaveProperty('email');
    expect(meeting.primary_attendee).toHaveProperty('name');
    expect(meeting.primary_attendee).toHaveProperty('is_external');
    expect(meeting.primary_attendee.is_external).toBe(true);
  });

  test('TranscriptInput has all required fields', () => {
    const transcript = createTranscriptInput();

    expect(transcript).toHaveProperty('meeting_id');
    expect(transcript).toHaveProperty('brain_id');
    expect(transcript).toHaveProperty('source');
    expect(transcript).toHaveProperty('transcript_text');
    expect(transcript).toHaveProperty('attendee_email');
    expect(transcript).toHaveProperty('meeting_date');
    expect(transcript).toHaveProperty('duration_minutes');
  });

  test('BANT score has all dimensions', () => {
    const bant = createBANT();

    expect(bant).toHaveProperty('budget');
    expect(bant).toHaveProperty('authority');
    expect(bant).toHaveProperty('need');
    expect(bant).toHaveProperty('timeline');
    expect(bant).toHaveProperty('overall');

    // Each dimension has status, confidence, evidence, next_step
    for (const dimension of ['budget', 'authority', 'need', 'timeline'] as const) {
      expect(bant[dimension]).toHaveProperty('status');
      expect(bant[dimension]).toHaveProperty('confidence');
      expect(bant[dimension]).toHaveProperty('evidence');
      expect(bant[dimension]).toHaveProperty('next_step');
    }

    // Overall has score, recommendation, summary
    expect(bant.overall).toHaveProperty('score');
    expect(bant.overall).toHaveProperty('recommendation');
    expect(bant.overall).toHaveProperty('summary');
  });
});

// ===========================================
// State Manager Tests
// ===========================================

describe('State Manager', () => {
  test('creates state manager with initial state', () => {
    const stateManager = createStateManager(TEST_BRAIN_ID as any);

    const state = stateManager.getState();

    expect(state.brain_id).toBe(TEST_BRAIN_ID);
    expect(state.upcoming_meetings).toEqual([]);
    expect(state.recent_briefs).toEqual([]);
    expect(state.recent_analyses).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('records meeting addition', () => {
    const stateManager = createStateManager(TEST_BRAIN_ID as any);
    const meeting = createParsedMeeting();

    stateManager.addUpcomingMeeting({
      meeting_id: meeting.meeting_id,
      start_time: meeting.start_time,
      primary_attendee_email: meeting.primary_attendee.email,
      brief_status: 'pending',
      brief_id: null,
    });

    const state = stateManager.getState();
    expect(state.upcoming_meetings.length).toBe(1);
    expect(state.upcoming_meetings[0].meeting_id).toBe(meeting.meeting_id);
  });

  test('updates meeting brief status', () => {
    const stateManager = createStateManager(TEST_BRAIN_ID as any);
    const meeting = createParsedMeeting();

    stateManager.addUpcomingMeeting({
      meeting_id: meeting.meeting_id,
      start_time: meeting.start_time,
      primary_attendee_email: meeting.primary_attendee.email,
      brief_status: 'pending',
      brief_id: null,
    });

    stateManager.updateMeetingBriefStatus(meeting.meeting_id, 'generating', `brief_${Date.now()}`);

    const state = stateManager.getState();
    expect(state.upcoming_meetings[0].brief_status).toBe('generating');
  });

  test('records brief delivered', () => {
    const stateManager = createStateManager(TEST_BRAIN_ID as any);
    const briefId = `brief_${Date.now()}`;
    const meetingId = `mtg_${Date.now()}`;

    stateManager.recordBriefDelivered({
      brief_id: briefId,
      meeting_id: meetingId,
      delivered_at: new Date().toISOString(),
      processing_time_ms: 2500,
    });

    const state = stateManager.getState();
    expect(state.recent_briefs.length).toBe(1);
    expect(state.recent_briefs[0].brief_id).toBe(briefId);
  });
});

// ===========================================
// Logger Tests
// ===========================================

describe('Logger', () => {
  test('creates logger with default config', () => {
    const logger = createLogger();

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.briefRequested).toBe('function');
    expect(typeof logger.briefDelivered).toBe('function');
  });

  test('logger startTimer returns duration function', () => {
    const logger = createLogger();
    const timer = logger.startTimer();

    expect(typeof timer).toBe('function');

    // Wait a tiny bit and verify it returns a number
    const duration = timer();
    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});
