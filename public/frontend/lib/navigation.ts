/**
 * CryptoExam Core — Site map (single source of truth)
 *
 * The tab bar, the role hubs, the portal sidebars, the ⌘K command palette,
 * /explore and the footer all read from THIS module. Adding a route here
 * surfaces it everywhere at once, so the navigation surfaces cannot drift.
 *
 * Two things make this more than a link list:
 *
 *   `stage`  — where a feature sits in that role's journey. Alphabetical lists
 *              assume you know the name of the thing; stage grouping only
 *              assumes you know where you are in the process, which is always
 *              true. Hubs and sidebars both render from it.
 *
 *   `TABS`   — the five top-level destinations. The four role tabs reuse the
 *              EXISTING route namespaces (/exam, /setter, …) rather than
 *              creating a parallel tree, so a hub always lives at the root of
 *              the features it describes.
 *
 * `keywords` exist purely to widen command-palette matching — someone typing
 * "paper leak", "merkle" or "seating" should still land on the right page.
 */

export type NavItem = {
  title: string;
  href: string;
  desc: string;
  /** lucide icon name, rendered via components/marketing/LucideIcon */
  icon: string;
  /** Journey stage within this role. Drives hub + sidebar grouping. */
  stage?: string;
  keywords?: string[];
  /** Shown with a lock affordance — reachable, but asks for credentials. */
  auth?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  blurb: string;
  icon: string;
  /** Ordered stage names. Order here is the order the hub renders them. */
  stages?: string[];
  items: NavItem[];
};

/** The five top-level tabs, held on every page. Short labels by design. */
export type Tab = {
  id: string;
  short: string;
  href: string;
  /** Which NavGroup this tab surfaces (absent for Home). */
  group?: string;
  /** Route prefix used to mark the tab active. */
  match?: string;
};

/**
 * Hubs live on their own routes rather than at /setter, /admin, … because
 * app/{setter,admin,exam}/layout.tsx wrap EVERY child in authenticated portal
 * chrome. A public hub at /setter would render inside the signed-in sidebar.
 * The bare namespaces redirect here instead, so old links still land.
 *
 * `match` lists the prefixes that light this tab up, so a page deep inside a
 * portal still shows you which section you are in.
 */
export const TABS: Tab[] = [
  { id: "home", short: "Home", href: "/" },
  { id: "candidate", short: "Candidates", href: "/candidates", group: "candidate", match: "/candidates,/exam,/login,/candidate-enrolment" },
  { id: "setter", short: "Setters", href: "/setters", group: "setter", match: "/setters,/setter" },
  { id: "invigilator", short: "Invigilators", href: "/invigilators", group: "invigilator", match: "/invigilators,/invigilator" },
  { id: "admin", short: "Admin", href: "/administration", group: "admin", match: "/administration,/admin" },
];

/** True when `pathname` sits inside one of a tab's route prefixes. */
export function isTabActive(tab: Tab, pathname: string): boolean {
  if (tab.id === "home") return pathname === "/";
  return (tab.match || "")
    .split(",")
    .filter(Boolean)
    .some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Sign-in route per role — used by the tab bar's signed-out state. */
export const SIGN_IN: Record<string, string> = {
  candidate: "/login?role=candidate",
  setter: "/login?role=setter",
  invigilator: "/login?role=invigilator",
  admin: "/login?role=admin",
};

export const GROUPS: NavGroup[] = [
  {
    id: "candidate",
    label: "Candidates",
    blurb: "Sit the exam, check your machine and raise exam-day issues.",
    icon: "graduation-cap",
    stages: ["Before exam day", "On the day", "Afterwards"],
    items: [
      { title: "Enrolment", href: "/candidate-enrolment", stage: "Before exam day", desc: "Register your face and details before exam day.", icon: "user-plus", keywords: ["register", "biometric", "face", "enrol"] },
      { title: "System check", href: "/exam/system-check", stage: "Before exam day", desc: "Confirm the terminal meets exam requirements.", icon: "monitor-check", keywords: ["hardware", "browser", "readiness", "test"] },
      { title: "My dashboard", href: "/exam/dashboard", stage: "Before exam day", desc: "Upcoming exams, admit cards and centre allocation.", icon: "layout-dashboard", auth: true, keywords: ["admit card", "upcoming"] },
      { title: "T₀ broadcast", href: "/exam/t0-broadcast", stage: "On the day", desc: "The synchronised moment every paper unseals.", icon: "radio", keywords: ["start", "unseal", "drand", "beacon"] },
      { title: "Raise a complaint", href: "/exam/complaint", stage: "Afterwards", desc: "Formally dispute a question or an exam-day incident.", icon: "message-square-warning", keywords: ["dispute", "grievance", "objection"] },
    ],
  },
  {
    id: "setter",
    label: "Question setters",
    blurb: "Author, calibrate and seal papers that nobody can read early.",
    icon: "pen-tool",
    stages: ["Author", "Generate", "Calibrate", "Prove & seal", "Oversee"],
    items: [
      { title: "Create a paper", href: "/setter/create", stage: "Author", desc: "Start a new examination from a blueprint.", icon: "file-plus", auth: true, keywords: ["new", "blueprint"] },
      { title: "Question bank", href: "/setter/questions", stage: "Author", desc: "Browse, edit and tag the item pool.", icon: "library", auth: true, keywords: ["items", "pool", "bank"] },
      { title: "Paper modes", href: "/setter/paper-modes", stage: "Author", desc: "Choose direct upload, AI-assisted editing or full generation.", icon: "sliders-horizontal", auth: true, keywords: ["upload", "ai", "generate", "modes"] },
      { title: "Direct upload", href: "/setter/paper-modes/direct-upload", stage: "Author", desc: "Bring an existing paper in as-is and seal it.", icon: "upload", auth: true, keywords: ["upload", "pdf", "import", "existing"] },
      { title: "AI-edited paper", href: "/setter/paper-modes/ai-edited", stage: "Author", desc: "Draft it yourself, let the agents tighten and check it.", icon: "wand-sparkles", auth: true, keywords: ["ai", "assist", "edit", "review"] },
      { title: "AI-generated paper", href: "/setter/paper-modes/ai-generated", stage: "Author", desc: "Generate a full paper from a blueprint and syllabus.", icon: "sparkles", auth: true, keywords: ["ai", "generate", "auto", "blueprint"] },
      { title: "Generation run", href: "/setter/generate", stage: "Generate", desc: "Watch the six-agent pipeline compose and score items.", icon: "bot", auth: true, keywords: ["agents", "pipeline", "irt", "blooms", "generate"] },
      { title: "IRT calibration", href: "/setter/irt", stage: "Calibrate", desc: "3PL difficulty, discrimination and guessing parameters.", icon: "chart-spline", auth: true, keywords: ["difficulty", "3pl", "psychometrics", "calibration"] },
      { title: "Difficulty proofs", href: "/setter/proofs", stage: "Prove & seal", desc: "ZK-SNARK proof that the paper meets its difficulty spec.", icon: "badge-check", keywords: ["zk", "snark", "groth16", "proof"] },
      { title: "Workbench", href: "/setter/dashboard", stage: "Oversee", desc: "Every paper you own and its current stage.", icon: "layout-dashboard", auth: true },
    ],
  },
  {
    id: "invigilator",
    label: "Invigilators",
    blurb: "Verify identity, seat candidates and log incidents at the centre.",
    icon: "user-check",
    stages: ["Get credentialed", "Before the session", "During the session", "Afterwards"],
    items: [
      { title: "Register as staff", href: "/invigilator/register", stage: "Get credentialed", desc: "Apply for invigilator credentials at a centre.", icon: "user-plus", keywords: ["apply", "staff", "onboard"] },
      { title: "Candidate roster", href: "/invigilator/roster", stage: "Before the session", desc: "Who is expected, who has arrived.", icon: "users", auth: true, keywords: ["attendance", "list"] },
      { title: "Identity verification", href: "/invigilator/verify", stage: "During the session", desc: "Face and fingerprint check against the centre record.", icon: "scan-face", auth: true, keywords: ["biometric", "face", "fingerprint", "identity"] },
      { title: "Centre console", href: "/invigilator/dashboard", stage: "During the session", desc: "Live seat map and hall status.", icon: "layout-dashboard", auth: true, keywords: ["seat map", "hall"] },
      { title: "Alerts", href: "/invigilator/alerts", stage: "During the session", desc: "Real-time anomalies raised by the terminals.", icon: "bell-ring", auth: true, keywords: ["anomaly", "warning"] },
      { title: "Incident report", href: "/invigilator/report", stage: "Afterwards", desc: "File a formal record of an exam-hall event.", icon: "clipboard-list", auth: true, keywords: ["incident", "log"] },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    blurb: "Run the estate: exams, centres, hardware, keys and emergencies.",
    icon: "shield",
    stages: ["Set up the estate", "Run exams", "Assurance", "Break glass"],
    items: [
      { title: "Centres", href: "/admin/centers", stage: "Set up the estate", desc: "Accredited examination centres nationwide.", icon: "building-2", auth: true, keywords: ["venues", "locations"] },
      { title: "Hardware nodes", href: "/admin/nodes", stage: "Set up the estate", desc: "TPM attestation and GPS state per terminal.", icon: "server", auth: true, keywords: ["tpm", "terminals", "gps"] },
      { title: "Roles", href: "/admin/roles", stage: "Set up the estate", desc: "Who may do what, and who granted it.", icon: "key-round", auth: true, keywords: ["rbac", "permissions"] },
      { title: "Centre-admin approvals", href: "/admin/centre-admin-approvals", stage: "Set up the estate", desc: "Authorise the tier below you.", icon: "user-round-check", auth: true, keywords: ["approve", "tier"] },
      { title: "Mission control", href: "/admin/dashboard", stage: "Run exams", desc: "Live status across every exam and centre.", icon: "gauge", auth: true, keywords: ["overview", "status"] },
      { title: "Exams", href: "/admin/exams", stage: "Run exams", desc: "Lifecycle from draft to sealed to completed.", icon: "calendar-days", auth: true },
      { title: "Candidates", href: "/admin/candidates", stage: "Run exams", desc: "The national candidate roster.", icon: "users", auth: true },
      { title: "Blockchain audit", href: "/admin/blockchain", stage: "Assurance", desc: "Every on-chain commitment this platform has made.", icon: "link-2", auth: true, keywords: ["polygon", "chain", "commitments"] },
      { title: "Answer vault", href: "/admin/answer-vault", stage: "Assurance", desc: "Sealed answer bundles awaiting HQ decryption.", icon: "vault", auth: true, keywords: ["hsm", "decrypt", "sealed"] },
      { title: "Reports", href: "/admin/reports", stage: "Assurance", desc: "Operational and compliance reporting.", icon: "file-bar-chart", auth: true },
      { title: "Emergency control", href: "/admin/emergency", stage: "Break glass", desc: "Dual-control halt with an on-chain reason.", icon: "octagon-alert", auth: true, keywords: ["pause", "halt", "stop", "abort"] },
    ],
  },

  /* ── Not tabs. These are absorbed into Home as proof and depth. ── */
  {
    id: "learn",
    label: "Learn",
    blurb: "How the system works and who it is built for.",
    icon: "book-open",
    items: [
      { title: "Platform", href: "/platform", desc: "The full architecture, layer by layer.", icon: "layers", keywords: ["architecture", "how it works", "tech"] },
      { title: "About", href: "/about", desc: "Why this exists and what it guarantees.", icon: "info", keywords: ["mission", "team"] },
      { title: "Centre access", href: "/center-access", desc: "Why exam terminals boot a locked operating system.", icon: "hard-drive", keywords: ["zuup", "os", "kiosk", "terminal"] },
      { title: "Privacy", href: "/privacy", desc: "DPDP Act 2023 commitments.", icon: "lock", keywords: ["dpdp", "data", "gdpr"] },
      { title: "Terms", href: "/terms", desc: "Terms of use.", icon: "scroll" },
    ],
  },
  {
    id: "start",
    label: "Get started",
    blurb: "Bring CryptoExam Core to your examination body.",
    icon: "rocket",
    items: [
      { title: "Request a briefing", href: "/contact", desc: "Talk to us about your examination.", icon: "mail", keywords: ["contact", "demo", "sales", "briefing"] },
      { title: "Centre-staff registration", href: "/staff-registration", desc: "Register personnel for an accredited centre.", icon: "clipboard-pen", keywords: ["staff", "register", "centre"] },
      { title: "Login", href: "/login", desc: "One sign-in for all four roles — candidate, setter, invigilator, admin.", icon: "log-in", keywords: ["login", "sign in", "signin", "log in", "portal", "access"] },
      { title: "Explore everything", href: "/explore", desc: "The complete feature directory.", icon: "compass", keywords: ["all", "directory", "index", "sitemap", "features"] },
    ],
  },
];

/** Groups shown as columns in the desktop mega-menu. */
export const MEGA_MENU_GROUPS = ["candidate", "setter", "invigilator", "admin"];

export const byId = (id: string) => GROUPS.find((g) => g.id === id);

/** Items of a group bucketed into its declared stage order. */
export function stagesOf(groupId: string): { stage: string; items: NavItem[] }[] {
  const g = byId(groupId);
  if (!g?.stages) return [];
  return g.stages
    .map((stage) => ({ stage, items: g.items.filter((i) => i.stage === stage) }))
    .filter((s) => s.items.length > 0);
}

/** Flat, de-duplicated index — what the command palette searches. */
export const ALL_ITEMS: (NavItem & { group: string; groupId: string })[] =
  GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label, groupId: g.id })));

/**
 * Score an item against a query. Higher is better; 0 means "no match".
 * Deliberately simple: an exact prefix on the title should always outrank a
 * loose keyword hit, so the obvious answer lands first.
 */
export function scoreItem(item: NavItem & { group: string }, q: string): number {
  const query = q.trim().toLowerCase();
  if (!query) return 1;
  const title = item.title.toLowerCase();
  const desc = item.desc.toLowerCase();
  const group = item.group.toLowerCase();
  const keys = (item.keywords || []).join(" ").toLowerCase();
  const stage = (item.stage || "").toLowerCase();

  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (keys.split(/\s+/).some((k) => k === query)) return 50;
  if (keys.includes(query)) return 40;
  if (group.includes(query)) return 30;
  if (stage.includes(query)) return 25;
  if (desc.includes(query)) return 20;

  // Subsequence fallback so "adbd" still reaches "Admin dashboard".
  let i = 0;
  for (const ch of title) if (ch === query[i]) i++;
  if (i === query.length) return 10;

  return 0;
}

export function searchItems(q: string) {
  return ALL_ITEMS
    .map((it) => ({ item: it, score: scoreItem(it, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .map((r) => r.item);
}
