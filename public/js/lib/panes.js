// The UI half of rule 3. Which tabs exist for which role, and which controls render.
// The server re-checks every one of these independently; this file only decides what is
// put in the DOM. Tabs and controls a role cannot use are never rendered at all.

const ALL = ["owner", "admin", "team"];
const OA = ["owner", "admin"];
const O = ["owner"];

export const PANES = [
  { id: "bookings", title: "Bookings", roles: ALL },
  { id: "slot-requests", title: "Slot requests", roles: OA },
  { id: "availability", title: "Availability", roles: OA },
  { id: "content", title: "Content", roles: OA },
  { id: "answers", title: "Answers", roles: OA },
  { id: "signals", title: "Signals", roles: ALL },
  { id: "traffic", title: "Traffic", roles: ALL },
  { id: "team", title: "Team", roles: O },
  { id: "audit", title: "Audit", roles: O },
  { id: "settings", title: "Settings", roles: OA },
];

/** Controls inside panes, keyed "<function>.<action>" to match the Edge Functions. */
export const CONTROLS = {
  "admin-bookings.email_link": OA,
  "admin-bookings.export_csv": O,
  "admin-bookings.revenue": O,
  "admin-slot-requests.approve": OA,
  "admin-slot-requests.decline": OA,
  "admin-availability.save_rules": OA,
  "admin-availability.add_override": OA,
  "admin-availability.remove_override": OA,
  "admin-content.save": OA,
  "admin-answers.save": OA,
  "admin-team.invite": O,
  "admin-team.set_role": O,
  "admin-team.set_active": O,
  "admin-team.resend_link": O,
  "admin-audit.export_csv": O,
  "admin-settings.save": OA,
  "trigger-publish.publish": OA,
};

export const panesFor = (role) => PANES.filter((p) => p.roles.includes(role));
export const canSee = (role, paneId) => panesFor(role).some((p) => p.id === paneId);
export const can = (role, control) => (CONTROLS[control] ?? []).includes(role);
