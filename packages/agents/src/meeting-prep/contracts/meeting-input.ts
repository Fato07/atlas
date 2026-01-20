/**
 * Meeting Input Contract
 *
 * Defines the schema for calendar webhook payloads and meeting data.
 * Used for validating incoming n8n webhook requests.
 *
 * @module meeting-prep/contracts/meeting-input
 */

import { z } from 'zod';

// ===========================================
// Attendee Schema
// ===========================================

export const AttendeeSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
  response_status: z.enum(['accepted', 'declined', 'tentative', 'needsAction']).optional(),
  is_organizer: z.boolean().optional().default(false),
});

export type Attendee = z.infer<typeof AttendeeSchema>;

// ===========================================
// Calendar Event Schema
// ===========================================

export const CalendarEventSchema = z.object({
  event_id: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().nullable().optional(),

  start: z.object({
    dateTime: z.string().datetime({ offset: true }),
    timeZone: z.string().optional(),
  }),

  end: z.object({
    dateTime: z.string().datetime({ offset: true }),
    timeZone: z.string().optional(),
  }),

  attendees: z.array(AttendeeSchema).min(1),

  // Meeting link (Google Meet, Zoom, Teams, etc.)
  hangoutLink: z.string().url().nullable().optional(),
  conferenceData: z
    .object({
      entryPoints: z
        .array(
          z.object({
            entryPointType: z.string(),
            uri: z.string().url(),
          })
        )
        .optional(),
    })
    .nullable()
    .optional(),

  status: z.enum(['confirmed', 'cancelled', 'tentative']).default('confirmed'),
  recurringEventId: z.string().nullable().optional(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ===========================================
// Calendar Webhook Schema (from n8n)
// ===========================================

export const CalendarWebhookPayloadSchema = z.object({
  event_type: z.enum(['meeting_reminder', 'meeting_created', 'meeting_cancelled']),
  brain_id: z.string().min(1),
  event: CalendarEventSchema,
  trigger_time: z.string().datetime({ offset: true }).optional(),
});

export type CalendarWebhookPayload = z.infer<typeof CalendarWebhookPayloadSchema>;

// ===========================================
// Manual Brief Request Schema
// ===========================================

export const ManualBriefRequestSchema = z.object({
  // Either meeting_id or attendee_email must be provided
  meeting_id: z.string().optional(),
  attendee_email: z.string().email().optional(),
  brain_id: z.string().min(1),
})
  .refine(
    (data) => data.meeting_id || data.attendee_email,
    'Either meeting_id or attendee_email must be provided'
  );

export type ManualBriefRequest = z.infer<typeof ManualBriefRequestSchema>;

// ===========================================
// Parsed Meeting Schema (internal)
// ===========================================

export const ParsedMeetingSchema = z.object({
  meeting_id: z.string(),
  brain_id: z.string().min(1),

  title: z.string(),
  description: z.string().nullable(),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  timezone: z.string(),

  primary_attendee: z.object({
    email: z.string().email(),
    name: z.string().nullable(),
    is_external: z.literal(true),
  }),

  other_attendees: z.array(
    z.object({
      email: z.string().email(),
      name: z.string().nullable(),
      is_external: z.boolean(),
    })
  ),

  meeting_link: z.string().url().nullable(),
  meeting_type: z.enum(['google_meet', 'zoom', 'teams', 'other', 'unknown']),

  status: z.enum(['confirmed', 'cancelled', 'tentative']),
  recurring_event_id: z.string().nullable(),

  created_at: z.string().datetime({ offset: true }),
  source: z.enum(['calendar_webhook', 'manual_request']),
});

export type ParsedMeeting = z.infer<typeof ParsedMeetingSchema>;

// ===========================================
// Helper Functions
// ===========================================

/**
 * Extract the primary external attendee from a list of attendees.
 * Returns the first non-organizer attendee with an external email domain.
 */
export function extractPrimaryExternalAttendee(
  attendees: Attendee[],
  internalDomains: string[] = ['codesdevs.com'],
): Attendee | null {
  const externals = attendees.filter((a) => {
    if (a.is_organizer) return false;
    const domain = a.email.split('@')[1]?.toLowerCase();
    return domain && !internalDomains.some((d) => domain === d.toLowerCase());
  });

  return externals[0] ?? null;
}

/**
 * Extract meeting link from calendar event.
 * Prioritizes hangoutLink, then conferenceData entryPoints.
 */
export function extractMeetingLink(event: CalendarEvent): {
  link: string | null;
  type: 'google_meet' | 'zoom' | 'teams' | 'other' | 'unknown';
} {
  // Check hangoutLink first (Google Meet)
  if (event.hangoutLink) {
    return { link: event.hangoutLink, type: 'google_meet' };
  }

  // Check conferenceData entryPoints
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === 'video'
  );

  if (videoEntry?.uri) {
    const uri = videoEntry.uri.toLowerCase();
    if (uri.includes('zoom.us')) return { link: videoEntry.uri, type: 'zoom' };
    if (uri.includes('teams.microsoft.com')) return { link: videoEntry.uri, type: 'teams' };
    if (uri.includes('meet.google.com')) return { link: videoEntry.uri, type: 'google_meet' };
    return { link: videoEntry.uri, type: 'other' };
  }

  return { link: null, type: 'unknown' };
}

/**
 * Check if meeting is an internal meeting (no external attendees).
 */
export function isInternalMeeting(
  attendees: Attendee[],
  internalDomains: string[] = ['codesdevs.com'],
): boolean {
  return extractPrimaryExternalAttendee(attendees, internalDomains) === null;
}

/**
 * Calculate minutes until meeting starts.
 */
export function minutesUntilMeeting(startTime: string): number {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  return Math.floor((start - now) / (1000 * 60));
}
