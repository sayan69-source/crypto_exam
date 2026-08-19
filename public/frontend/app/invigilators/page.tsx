import RoleHub from "@/components/marketing/RoleHub";

export const metadata = {
  title: "Invigilators — CryptoExam Core",
  description: "Verify identity, seat candidates and log incidents at the centre.",
};

export default function InvigilatorsHub() {
  return (
    <RoleHub
      groupId="invigilator"
      intro="Run the hall: confirm each candidate is who they say they are, seat them, watch the terminals, and record anything that goes wrong."
      access="Centre staff only. If you work at an accredited centre and do not yet have credentials, you can apply below — approval and in-person activation are both required."
      deeper={{
        label: "Why verification happens in person",
        href: "/center-access",
        desc: "Identity is checked locally against the centre's own records, offline. A stolen web session is worth nothing on exam day.",
      }}
    />
  );
}
