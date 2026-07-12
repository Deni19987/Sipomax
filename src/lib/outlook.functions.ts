import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { lookupRegisterutdragByReg } from "./outlook.server";

export const lookupRegisterutdrag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ registration_number: z.string().min(2).max(20) }).parse(d),
  )
  .handler(async ({ data }) => {
    return lookupRegisterutdragByReg(data.registration_number);
  });