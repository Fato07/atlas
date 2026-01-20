/**
 * Manual Brief Request Handler
 *
 * Handles on-demand brief generation requests via API or Slack command.
 * Supports lookup by meeting_id or attendee_email.
 *
 * Implements FR-007 (manual brief request).
 *
 * @module meeting-prep/manual-request-handler
 */

import type { BrainId } from '@atlas-gtm/lib';
import type { ManualBriefRequest, ParsedMeeting } from './contracts/meeting-input';
import type { MeetingPrepLogger } from './logger';
import type { MeetingPrepStateManager } from './state';
import type { UpcomingMeeting } from './types';
import type { ContextGatherer } from './context-gatherer';
import type { BriefGenerator } from './brief-generator';
import type { SlackBriefDelivery } from './slack-delivery';
import { createPendingBrief } from './contracts/brief';

// ===========================================
// Types
// ===========================================

export interface ManualRequestHandlerConfig {
  /** Maximum hours in the future to look for meetings */
  maxHoursAhead: number;
  /** Slack channel for brief delivery */
  slackBriefChannel: string;
}

export const DEFAULT_MANUAL_REQUEST_CONFIG: ManualRequestHandlerConfig = {
  maxHoursAhead: 48,
  slackBriefChannel: 'meeting-briefs',
};

export interface ManualRequestHandlerDependencies {
  /** Logger instance */
  logger: MeetingPrepLogger;
  /** State manager for meeting lookup */
  stateManager: MeetingPrepStateManager;
  /** Context gatherer */
  contextGatherer: ContextGatherer;
  /** Brief generator */
  briefGenerator: BriefGenerator;
  /** Slack delivery */
  slackDelivery: SlackBriefDelivery;
}

export interface HandleManualRequestInput {
  brainId: BrainId;
  request: ManualBriefRequest;
}

export interface HandleManualRequestResult {
  success: true;
  brief_id: string;
  meeting_id: string;
  message: string;
  processing_time_ms: number;
}

export interface HandleManualRequestError {
  success: false;
  error: string;
  code:
    | 'MEETING_NOT_FOUND'
    | 'NO_UPCOMING_MEETINGS'
    | 'CONTEXT_GATHERING_FAILED'
    | 'BRIEF_GENERATION_FAILED'
    | 'DELIVERY_FAILED';
  processing_time_ms: number;
}

export type HandleManualRequestOutput =
  | HandleManualRequestResult
  | HandleManualRequestError;

// ===========================================
// Manual Request Handler
// ===========================================

export class ManualRequestHandler {
  private readonly config: ManualRequestHandlerConfig;
  private readonly deps: ManualRequestHandlerDependencies;

  constructor(
    deps: ManualRequestHandlerDependencies,
    config?: Partial<ManualRequestHandlerConfig>
  ) {
    this.config = { ...DEFAULT_MANUAL_REQUEST_CONFIG, ...config };
    this.deps = deps;
  }

  /**
   * Handle a manual brief request.
   *
   * Flow:
   * 1. Look up meeting by ID or find upcoming meeting for attendee
   * 2. Gather context from all sources
   * 3. Generate brief with Claude
   * 4. Deliver via Slack
   */
  async handle(input: HandleManualRequestInput): Promise<HandleManualRequestOutput> {
    const startTime = Date.now();
    const { brainId, request } = input;

    this.deps.logger.debug('Handling manual brief request', {
      meeting_id: request.meeting_id,
      attendee_email: request.attendee_email,
    });

    // Step 1: Find the meeting
    const meetingResult = await this.findMeeting(request);
    if (!meetingResult.success) {
      return {
        success: false,
        error: meetingResult.error,
        code: meetingResult.code,
        processing_time_ms: Date.now() - startTime,
      };
    }

    const meeting = meetingResult.meeting;
    const briefId = createPendingBrief(meeting.meeting_id, brainId).brief_id;

    this.deps.logger.info('Found meeting for manual brief', {
      meeting_id: meeting.meeting_id,
      brief_id: briefId,
      attendee: meeting.primary_attendee.email,
    });

    // Step 2: Gather context
    const contextResult = await this.deps.contextGatherer.gather({
      brainId,
      briefId,
      meeting,
    });

    if (!contextResult.success) {
      const failedSourcesInfo =
        contextResult.failed_sources.length > 0
          ? ` (failed: ${contextResult.failed_sources.join(', ')})`
          : '';

      return {
        success: false,
        error: contextResult.error + failedSourcesInfo,
        code: 'CONTEXT_GATHERING_FAILED',
        processing_time_ms: Date.now() - startTime,
      };
    }

    // Step 3: Generate brief
    const generateResult = await this.deps.briefGenerator.generate({
      brainId,
      briefId,
      meeting,
      context: contextResult.context,
    });

    if (!generateResult.success) {
      return {
        success: false,
        error: generateResult.error,
        code: 'BRIEF_GENERATION_FAILED',
        processing_time_ms: Date.now() - startTime,
      };
    }

    // Step 4: Deliver via Slack
    const processingTime = Date.now() - startTime;
    const deliveryResult = await this.deps.slackDelivery.deliver({
      brainId,
      briefId,
      meeting,
      content: generateResult.content,
      channel: this.config.slackBriefChannel,
      totalProcessingMs: processingTime,
    });

    if (!deliveryResult.success) {
      return {
        success: false,
        error: deliveryResult.error,
        code: 'DELIVERY_FAILED',
        processing_time_ms: Date.now() - startTime,
      };
    }

    // Update state
    this.deps.stateManager.recordBriefDelivered({
      brief_id: briefId,
      meeting_id: meeting.meeting_id,
      delivered_at: deliveryResult.deliveredAt,
      processing_time_ms: Date.now() - startTime,
    });
    await this.deps.stateManager.checkpoint();

    return {
      success: true,
      brief_id: briefId,
      meeting_id: meeting.meeting_id,
      message: 'Brief generated and delivered successfully',
      processing_time_ms: Date.now() - startTime,
    };
  }

  /**
   * Find meeting by ID or attendee email.
   */
  private async findMeeting(
    request: ManualBriefRequest
  ): Promise<
    | { success: true; meeting: ParsedMeeting }
    | { success: false; error: string; code: 'MEETING_NOT_FOUND' | 'NO_UPCOMING_MEETINGS' }
  > {
    const state = this.deps.stateManager.getState();

    // Option 1: Look up by meeting_id
    if (request.meeting_id) {
      const upcomingMeeting = state.upcoming_meetings.find(
        (m) => m.meeting_id === request.meeting_id
      );

      if (!upcomingMeeting) {
        return {
          success: false,
          error: `Meeting not found: ${request.meeting_id}`,
          code: 'MEETING_NOT_FOUND',
        };
      }

      // Convert UpcomingMeeting to ParsedMeeting
      // Note: We may need to re-fetch meeting details from calendar
      // For now, construct a minimal ParsedMeeting from state
      const meeting = this.buildParsedMeetingFromState(upcomingMeeting, request.brain_id);
      return { success: true, meeting };
    }

    // Option 2: Find upcoming meeting for attendee email
    if (request.attendee_email) {
      const email = request.attendee_email.toLowerCase();
      const now = Date.now();
      const maxTime = now + this.config.maxHoursAhead * 60 * 60 * 1000;

      // Find meetings with this attendee that are upcoming
      const matchingMeetings = state.upcoming_meetings
        .filter((m) => {
          const meetingTime = new Date(m.start_time).getTime();
          return (
            m.primary_attendee_email.toLowerCase() === email &&
            meetingTime >= now &&
            meetingTime <= maxTime
          );
        })
        .sort(
          (a, b) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        );

      if (matchingMeetings.length === 0) {
        return {
          success: false,
          error: `No upcoming meetings found for ${request.attendee_email}`,
          code: 'NO_UPCOMING_MEETINGS',
        };
      }

      // Return the next upcoming meeting
      const nextMeeting = matchingMeetings[0];
      const meeting = this.buildParsedMeetingFromState(nextMeeting, request.brain_id);
      return { success: true, meeting };
    }

    // Should not reach here due to schema validation
    return {
      success: false,
      error: 'Either meeting_id or attendee_email must be provided',
      code: 'MEETING_NOT_FOUND',
    };
  }

  /**
   * Build a ParsedMeeting from UpcomingMeeting state.
   *
   * Note: This creates a minimal ParsedMeeting. In a full implementation,
   * we might want to re-fetch meeting details from the calendar API.
   */
  private buildParsedMeetingFromState(
    upcomingMeeting: UpcomingMeeting,
    brainId: string
  ): ParsedMeeting {
    const startTime = new Date(upcomingMeeting.start_time);
    return {
      meeting_id: upcomingMeeting.meeting_id,
      brain_id: brainId,
      title: `Meeting with ${upcomingMeeting.primary_attendee_email}`,
      description: null,
      start_time: upcomingMeeting.start_time,
      end_time: new Date(startTime.getTime() + 30 * 60 * 1000).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      primary_attendee: {
        email: upcomingMeeting.primary_attendee_email,
        name: null,
        is_external: true,
      },
      other_attendees: [],
      meeting_link: null,
      meeting_type: 'unknown',
      status: 'confirmed',
      recurring_event_id: null,
      created_at: new Date().toISOString(),
      source: 'manual_request',
    };
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a manual request handler instance.
 */
export function createManualRequestHandler(
  deps: ManualRequestHandlerDependencies,
  config?: Partial<ManualRequestHandlerConfig>
): ManualRequestHandler {
  return new ManualRequestHandler(deps, config);
}
