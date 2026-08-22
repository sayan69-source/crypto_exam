import { redirect } from "next/navigation";

/** The Setters hub is the public landing for this role; the portal lives
 *  under /setter/*. Old links to /setter land on the hub, not a login wall. */
export default function SetterIndex() {
  redirect("/setters");
}
