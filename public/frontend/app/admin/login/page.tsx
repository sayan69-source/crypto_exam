import { redirect } from "next/navigation";

/** There is one login UI — see /login. This route only forwards. */
export default function AdminLoginPage() {
  redirect("/login?role=admin");
}
