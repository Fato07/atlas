/**
 * Calendar Webhook Handler
 *
 * Parses and validates Google Calendar webhook payloads from n8n.
 * Filters internal meetings and extracts primary external attendees.
 *
 * Implements FR-001: Calendar Webhook Reception
 *
 * @module meeting-prep/calendar-handler
 */

import type { BrainId } from '@atlas-gtm/lib';
import type { MeetingPrepLogger } from './logger';

import {
  CalendarWebhookPayloadSchema,
  ParsedMeetingSchema,
  extractPrimaryExternalAttendee,
  extractMeetingLink,
  isInternalMeeting,
  minutesUntilMeeting,
  type CalendarWebhookPayload,
  type ParsedMeeting,
  type Attendee,
} from './contracts/meeting-input';

// ===========================================
// Configuration
// ===========================================

export interface CalendarHandlerConfig {
  /** Internal email domains to filter */
  internalDomains: string[];

  /** Minimum minutes before meeting to generate brief */
  minMinutesBeforeMeeting: number;
}

export const DEFAULT_CALENDAR_HANDLER_CONFIG: CalendarHandlerConfig = {
  internalDomains: ['codesdevs.com'],
  minMinutesBeforeMeeting: 5,
};

// ===========================================
// Handler Result Types
// ===========================================

export interface CalendarHandlerResult {
  success: true;
  meeting: ParsedMeeting;
  minutesUntil: number;
}

export interface CalendarHandlerSkipped {
  success: false;
  reason: 'internal_meeting' | 'cancelled' | 'past_meeting' | 'too_soon';
  message: string;
}

export interface CalendarHandlerError {
  success: false;
  reason: 'invalid_payload' | 'no_external_attendee';
  message: string;
  details?: unknown;
}

export type HandleCalendarResult =
  | CalendarHandlerResult
  | CalendarHandlerSkipped
  | CalendarHandlerError;

// ===========================================
// Calendar Handler Class
// ===========================================

export class CalendarHandler {
  private readonly config: CalendarHandlerConfig;
  private readonly logger: MeetingPrepLogger;

  constructor(logger: MeetingPrepLogger, config?: Partial<CalendarHandlerConfig>) {
    this.config = { ...DEFAULT_CALENDAR_HANDLER_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Handle a raw calendar webhook payload.
   * Validates, parses, and filters the event.
   */
  async handle(rawPayload: unknown): Promise<HandleCalendarResult> {
    // Parse and validate the webhook payload
    const parseResult = CalendarWebhookPayloadSchema.safeParse(rawPayload);

    if (!parseResult.success) {
      return {
        success: false,
        reason: 'invalid_payload',
        message: 'Failed to parse calendar webhook payload',
        details: parseResult.error.flatten(),
      };
    }

    const payload = parseResult.data;

    // Handle cancelled events
    if (
      payload.event.status === 'cancelled' ||
      payload.event_type === 'meeting_cancelled'
    ) {
      return {
        success: false,
        reason: 'cancelled',
        message: `Meeting ${payload.event.event_id} has been cancelled`,
      };
    }

    // Check if internal meeting (no external attendees)
    if (isInternalMeeting(payload.event.attendees, this.config.internalDomains)) {
      return {
        success: false,
        reason: 'internal_meeting',
        message: 'Skipping internal meeting with no external attendees',
      };
    }

    // Calculate time until meeting
    const minutesUntil = minutesUntilMeeting(payload.event.start.dateTime);

    // Check if meeting is in the past
    if (minutesUntil < 0) {
      return {
        success: false,
        reason: 'past_meeting',
        message: `Meeting ${payload.event.event_id} has already started`,
      };
    }

    // Check if too close to meeting time
    if (minutesUntil < this.config.minMinutesBeforeMeeting) {
      return {
        success: false,
        reason: 'too_soon',
        message: `Only ${minutesUntil} minutes until meeting, minimum is ${this.config.minMinutesBeforeMeeting}`,
      };
    }

    // Extract primary external attendee
    const primaryAttendee = extractPrimaryExternalAttendee(
      payload.event.attendees,
      this.config.internalDomains
    );

    if (!primaryAttendee) {
      return {
        success: false,
        reason: 'no_external_attendee',
        message: 'No external attendee found after filtering',
      };
    }

    // Extract meeting link
    const meetingInfo = extractMeetingLink(payload.event);

    // Parse into internal meeting format
    const meeting = this.parseMeeting(payload, primaryAttendee, meetingInfo);

    // Log brief requested event
    this.logger.briefRequested({
      meeting_id: meeting.meeting_id,
      brain_id: meeting.brain_id,
      source: 'calendar_webhook',
      attendee_email: primaryAttendee.email,
      meeting_start: meeting.start_time,
    });

    return {
      success: true,
      meeting,
      minutesUntil,
    };
  }

  /**
   * Parse a validated webhook payload into a ParsedMeeting.
   */
  private parseMeeting(
    payload: CalendarWebhookPayload,
    primaryAttendee: Attendee,
    meetingInfo: { link: string | null; type: 'google_meet' | 'zoom' | 'teams' | 'other' | 'unknown' }
  ): ParsedMeeting {
    const { event } = payload;

    // Build other attendees list (excluding primary and organizer)
    const otherAttendees = event.attendees
      .filter((a) => {
        if (a.email === primaryAttendee.email) return false;
        return true;
      })
      .map((a) => ({
        email: a.email,
        name: a.name ?? null,
        is_external: !this.isInternalEmail(a.email),
      }));

    const meeting: ParsedMeeting = {
      meeting_id: event.event_id,
      brain_id: payload.brain_id as BrainId,

      title: event.summary,
      description: event.description ?? null,
      start_time: event.start.dateTime,
      end_time: event.end.dateTime,
      timezone: event.start.timeZone ?? 'UTC',

      primary_attendee: {
        email: primaryAttendee.email,
        name: primaryAttendee.name ?? null,
        is_external: true as const,
      },

      other_attendees: otherAttendees,

      meeting_link: meetingInfo.link,
      meeting_type: meetingInfo.type,

      status: event.status,
      recurring_event_id: event.recurringEventId ?? null,

      created_at: new Date().toISOString(),
      source: 'calendar_webhook',
    };

    // Validate the parsed meeting
    return ParsedMeetingSchema.parse(meeting);
  }

  /**
   * Check if an email is from an internal domain.
   */
  private isInternalEmail(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase();
    return (
      domain !== undefined &&
      this.config.internalDomains.some((d) => domain === d.toLowerCase())
    );
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create a calendar handler instance.
 */
export function createCalendarHandler(
  logger: MeetingPrepLogger,
  config?: Partial<CalendarHandlerConfig>
): CalendarHandler {
  return new CalendarHandler(logger, config);
}
