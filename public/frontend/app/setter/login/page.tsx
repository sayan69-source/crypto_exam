import { redirect } from "next/navigation";

/** There is one login UI. This route survives only so existing links and the
 *  auth guard's redirects still resolve; it forwards to the unified page with
 *  the Setter tab preselected. */
export default function SetterLoginPage() {
  redirect("/login?role=setter");
}
