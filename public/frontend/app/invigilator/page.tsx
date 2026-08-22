import { redirect } from "next/navigation";

/** The Invigilators hub is the public landing for this role; the portal
 *  lives under /invigilator/*. Old links land on the hub, not a login wall. */
export default function InvigilatorIndex() {
  redirect("/invigilators");
}
