// Who am I? The SPA calls this right after sign-in. A 403 here is the "Not authorised"
// screen; a role here decides which tabs are rendered. The server still re-checks the role
// on every other call — this answer is a convenience for the UI, never a permission.

import type { FunctionSpec } from "../_shared/types.ts";

export const spec: FunctionSpec = {
  name: "admin-me",
  actions: {
    me: {
      roles: ["owner", "admin", "team"],
      run: async ({ actor }) => ({ id: actor.id, email: actor.email, role: actor.role, full_name: actor.full_name }),
    },
  },
};
