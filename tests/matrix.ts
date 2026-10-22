// The expected role matrix, written out independently of the handlers from SPEC §8.

export const ALL = ["owner", "admin", "team"];
const OA = ["owner", "admin"];
const O = ["owner"];

export const EXPECTED: Record<string, Record<string, string[]>> = {
  "admin-me": { me: ALL },
  "admin-bookings": { list: ALL, detail: ALL, email_link: OA, export_csv: O },
  "admin-slot-requests": { list: OA, approve: OA, decline: OA },
  "admin-availability": { get: OA, save_rules: OA, add_override: OA, remove_override: OA },
  "admin-content": { list: OA, save: OA },
  "admin-answers": { list: OA, save: OA },
  "admin-signals": { list: ALL },
  "admin-traffic": { summary: ALL },
  "admin-team": { list: O, invite: O, set_role: O, set_active: O, resend_link: O },
  "admin-audit": { list: O, export_csv: O },
  "admin-settings": { get: OA, save: OA },
  "trigger-publish": { publish: OA, status: OA },
};
