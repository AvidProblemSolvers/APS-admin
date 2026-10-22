// Deno entry point. All logic, including the role check, lives in handler.ts + _shared/http.ts.
import { prodDeps } from "../_shared/adapters.ts";
import { serve } from "../_shared/http.ts";
import { spec } from "./handler.ts";

const deps = prodDeps((key) => Deno.env.get(key));

Deno.serve((req) => serve(spec, req, deps));
