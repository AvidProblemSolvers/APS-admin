// Every deployed admin Edge Function, by name. Tests iterate this list, so a new function
// that is not registered here fails the "every function is covered" test.
import { spec as answers } from "../supabase/functions/admin-answers/handler.ts";
import { spec as audit } from "../supabase/functions/admin-audit/handler.ts";
import { spec as availability } from "../supabase/functions/admin-availability/handler.ts";
import { spec as bookings } from "../supabase/functions/admin-bookings/handler.ts";
import { spec as content } from "../supabase/functions/admin-content/handler.ts";
import { spec as me } from "../supabase/functions/admin-me/handler.ts";
import { spec as settings } from "../supabase/functions/admin-settings/handler.ts";
import { spec as signals } from "../supabase/functions/admin-signals/handler.ts";
import { spec as slotRequests } from "../supabase/functions/admin-slot-requests/handler.ts";
import { spec as team } from "../supabase/functions/admin-team/handler.ts";
import { spec as traffic } from "../supabase/functions/admin-traffic/handler.ts";
import { spec as publish } from "../supabase/functions/trigger-publish/handler.ts";
import type { FunctionSpec } from "../supabase/functions/_shared/types.ts";

export const FUNCTIONS: Record<string, FunctionSpec> = Object.fromEntries(
  [me, bookings, slotRequests, availability, content, answers, signals, traffic, team, audit, settings, publish]
    .map((s) => [s.name, s]),
);
