import RoleHub from "@/components/marketing/RoleHub";

export const metadata = {
  title: "Candidates — CryptoExam Core",
  description: "Enrol, check your terminal, sit the exam and verify your own result.",
};

export default function CandidatesHub() {
  return (
    <RoleHub
      groupId="candidate"
      intro="Everything a candidate does, from enrolling months before the paper is written to checking your own answer record against the blockchain afterwards."
      access="The exam itself runs only on a sealed centre terminal — it cannot be opened in this browser. Everything else here is available to you now."
      deeper={{
        label: "Why the exam runs on a locked terminal",
        href: "/center-access",
        desc: "Your own laptop cannot be inspected — extensions, screen sharing, a second machine. The exam therefore runs inside an operating system that decides what may run at all.",
      }}
    />
  );
}
