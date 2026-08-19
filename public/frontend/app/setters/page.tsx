import RoleHub from "@/components/marketing/RoleHub";

export const metadata = {
  title: "Question setters — CryptoExam Core",
  description: "Author, calibrate and seal papers that nobody can read before T₀.",
};

export default function SettersHub() {
  return (
    <RoleHub
      groupId="setter"
      intro="Compose a paper, prove its difficulty without revealing a single question, and seal it so that not even the examining body can read it before the beacon fires."
      access="Authoring requires a setter account, issued by the examining body. The difficulty proofs are public — anyone can check a paper's fairness."
      deeper={{
        label: "How sealing and proving work",
        href: "/platform",
        desc: "The sealing layer, the ZK difficulty proof and the on-chain commitment, explained end to end.",
      }}
    />
  );
}
