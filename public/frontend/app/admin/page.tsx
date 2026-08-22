import { redirect } from "next/navigation";

/** The Administration hub is the public landing for this role; the portal
 *  lives under /admin/*. Old links to /admin land on the hub. */
export default function AdminIndex() {
  redirect("/administration");
}
