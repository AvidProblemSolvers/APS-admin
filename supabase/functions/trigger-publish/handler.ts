// SPEC §9: verifies owner or admin, fires repository_dispatch at the site repo with a
// stored PAT, returns the run so the admin can poll its status.

import { HttpError } from "../_shared/errors.ts";
import { isoDate } from "../_shared/http.ts";
import { publishSite, publishStatus } from "../_shared/publish.ts";
import type { FunctionSpec } from "../_shared/types.ts";

export const spec: FunctionSpec = {
  name: "trigger-publish",
  actions: {
    publish: { roles: ["owner", "admin"], run: (ctx) => publishSite(ctx, "manual") },
    status: {
      roles: ["owner", "admin"],
      run: (ctx) => {
        const id = ctx.body.run_id;
        if (id !== undefined && id !== null && !Number.isInteger(id)) throw new HttpError(400, "invalid_input");
        return publishStatus(ctx, (id as number) ?? null, isoDate(ctx.body, "since"));
      },
    },
  },
};
