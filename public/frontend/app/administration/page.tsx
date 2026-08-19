import RoleHub from "@/components/marketing/RoleHub";

export const metadata = {
  title: "Administration — CryptoExam Core",
  description: "Run the estate: exams, centres, hardware, keys and emergencies.",
};

export default function AdministrationHub() {
  return (
    <RoleHub
      groupId="admin"
      intro="Commission centres and terminals, run examinations across the estate, audit every on-chain commitment, and halt an exam under dual control if you have to."
      access="Restricted to authorised administrators. Sensitive actions require a second authoriser, and every one of them is recorded on-chain with its stated reason."
      deeper={{
        label: "The architecture you are operating",
        href: "/platform",
        desc: "Six layers, each producing evidence the next can check — and none of which requires trusting the operator.",
      }}
    />
  );
}
